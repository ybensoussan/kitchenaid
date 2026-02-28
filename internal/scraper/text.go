package scraper

import (
	"regexp"
	"strconv"
	"strings"

	"kitchenaid/internal/models"
)

// Section type constants.
const (
	sectionNone        = ""
	sectionDescription = "description"
	sectionIngredients = "ingredients"
	sectionSteps       = "steps"
)

var (
	rePrepTime    = regexp.MustCompile(`(?i)prep.?time[:\s]+(\d+)`)
	reCookTime    = regexp.MustCompile(`(?i)cook.?time[:\s]+(\d+)`)
	reServings    = regexp.MustCompile(`(?i)(?:serves?|servings?|yield[s]?)[:\s]+(\d+)`)
	reStepPrefix  = regexp.MustCompile(`^(?:\d+[.)]\s*|[-•]\s*)`)
	reIngredientStart = regexp.MustCompile(`^(?:\d|½|¼|¾|⅓|⅔|⅛|⅜|⅝|⅞|⅙|⅚)`)
	reKnownUnit   = regexp.MustCompile(`(?i)\b(cup|cups|tbsp|tsp|tablespoon|tablespoons|teaspoon|teaspoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|ml|kg|l|mg|fl\.?\s*oz|pint|pints|quart|quarts|gallon|gallons|piece|pieces|clove|cloves|head|heads|bunch|bunches|stalk|stalks|sprig|sprigs|slice|slices|can|cans|jar|jars|package|packages|pkg|bag|bags|pinch|pinches|dash|dashes)\b`)
)

var ingredientHeaders = []string{"ingredient", "what you need", "you'll need", "you will need"}
var stepHeaders = []string{"instruction", "direction", "step", "method", "how to", "preparation", "procedure"}
var descriptionHeaders = []string{"description", "about", "overview", "note", "introduction"}

func classifyHeader(line string) string {
	lower := strings.ToLower(strings.TrimRight(line, ":"))
	lower = strings.TrimSpace(lower)

	for _, h := range ingredientHeaders {
		if strings.Contains(lower, h) {
			return sectionIngredients
		}
	}
	for _, h := range stepHeaders {
		if strings.Contains(lower, h) {
			return sectionSteps
		}
	}
	for _, h := range descriptionHeaders {
		if strings.Contains(lower, h) {
			return sectionDescription
		}
	}
	return sectionNone
}

// isLikelySectionHeader returns true for short lines that are all-caps or
// match a known section keyword.
func isLikelySectionHeader(line string) (string, bool) {
	if len(line) == 0 {
		return "", false
	}
	// Short line with no digits that matches a known header keyword
	if len(line) <= 40 {
		if sec := classifyHeader(line); sec != sectionNone {
			return sec, true
		}
		// All-caps short line (e.g. "INGREDIENTS")
		if line == strings.ToUpper(line) && !strings.ContainsAny(line, "0123456789") {
			if sec := classifyHeader(line); sec != sectionNone {
				return sec, true
			}
		}
	}
	return sectionNone, false
}

// ParseRecipeText parses a plain-text recipe into a CreateRecipeRequest.
func ParseRecipeText(text string) (*models.CreateRecipeRequest, error) {
	lines := splitLines(text)

	req := &models.CreateRecipeRequest{}
	var prepTime, cookTime, servings int

	// First pass: extract metadata from any line
	for _, line := range lines {
		if m := rePrepTime.FindStringSubmatch(line); m != nil {
			if v, err := strconv.Atoi(m[1]); err == nil && prepTime == 0 {
				prepTime = v
			}
		}
		if m := reCookTime.FindStringSubmatch(line); m != nil {
			if v, err := strconv.Atoi(m[1]); err == nil && cookTime == 0 {
				cookTime = v
			}
		}
		if m := reServings.FindStringSubmatch(line); m != nil {
			if v, err := strconv.Atoi(m[1]); err == nil && servings == 0 {
				servings = v
			}
		}
	}
	req.PrepTime = prepTime
	req.CookTime = cookTime
	req.BaseServings = servings

	// Second pass: detect whether there are any section headers
	hasHeaders := false
	for _, line := range lines {
		if _, ok := isLikelySectionHeader(line); ok {
			hasHeaders = true
			break
		}
	}

	if hasHeaders {
		parseWithHeaders(lines, req)
	} else {
		parseFallback(lines, req)
	}

	if req.BaseServings == 0 {
		req.BaseServings = 4
	}
	return req, nil
}

// parseWithHeaders assigns lines to sections based on header detection.
func parseWithHeaders(lines []string, req *models.CreateRecipeRequest) {
	currentSection := sectionNone
	var preHeaderLines []string
	var descLines []string
	stepNum := 1

	for _, line := range lines {
		if isMetadataLine(line) {
			continue
		}

		if sec, ok := isLikelySectionHeader(line); ok {
			if currentSection == sectionNone {
				// We were collecting pre-header lines; flush them as title/description
				flushPreHeader(preHeaderLines, req)
				preHeaderLines = nil
			}
			currentSection = sec
			continue
		}

		if line == "" {
			continue
		}

		switch currentSection {
		case sectionNone:
			preHeaderLines = append(preHeaderLines, line)
		case sectionDescription:
			descLines = append(descLines, line)
		case sectionIngredients:
			ing := ParseIngredientLine(line)
			if ing.Name != "" {
				req.Ingredients = append(req.Ingredients, ing)
			}
		case sectionSteps:
			instruction := strings.TrimSpace(reStepPrefix.ReplaceAllString(line, ""))
			if instruction != "" {
				req.Steps = append(req.Steps, models.StepInput{
					StepNumber:  stepNum,
					Instruction: instruction,
				})
				stepNum++
			}
		}
	}

	// If we never hit a header, treat everything as pre-header
	if currentSection == sectionNone {
		flushPreHeader(preHeaderLines, req)
	}

	if len(descLines) > 0 && req.Description == "" {
		req.Description = strings.Join(descLines, " ")
	}
}

// flushPreHeader extracts title (first line) and description (rest) from lines
// collected before the first section header.
func flushPreHeader(lines []string, req *models.CreateRecipeRequest) {
	for i, line := range lines {
		if req.Title == "" {
			req.Title = line
		} else if i > 0 && req.Description == "" {
			remaining := lines[i:]
			req.Description = strings.Join(remaining, " ")
			break
		}
	}
}

// parseFallback handles recipes without section headers.
func parseFallback(lines []string, req *models.CreateRecipeRequest) {
	stepNum := 1
	titleSet := false

	for _, line := range lines {
		if isMetadataLine(line) || line == "" {
			continue
		}
		if !titleSet {
			req.Title = line
			titleSet = true
			continue
		}

		// Likely an ingredient: starts with a digit/fraction and contains a known unit
		if reIngredientStart.MatchString(line) && reKnownUnit.MatchString(line) {
			ing := ParseIngredientLine(line)
			if ing.Name != "" {
				req.Ingredients = append(req.Ingredients, ing)
				continue
			}
		}
		// Everything else is a step
		instruction := strings.TrimSpace(reStepPrefix.ReplaceAllString(line, ""))
		if instruction != "" {
			req.Steps = append(req.Steps, models.StepInput{
				StepNumber:  stepNum,
				Instruction: instruction,
			})
			stepNum++
		}
	}
}

// isMetadataLine returns true for lines that just carry metadata (times/servings).
func isMetadataLine(line string) bool {
	return rePrepTime.MatchString(line) || reCookTime.MatchString(line) || reServings.MatchString(line)
}

// splitLines splits text on newlines and trims each line.
func splitLines(text string) []string {
	raw := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(raw))
	for _, l := range raw {
		out = append(out, strings.TrimSpace(l))
	}
	return out
}
