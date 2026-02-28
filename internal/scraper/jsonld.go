package scraper

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"kitchenaid/internal/models"
)

// unitConversions maps unit names to metric equivalents.
var unitConversions = map[string]struct {
	mult float64
	to   string
}{
	// volume – imperial (only large/uncommon ones convert to ml)
	"fl oz":        {29.5735, "ml"},
	"fl. oz":       {29.5735, "ml"},
	"fl. oz.":      {29.5735, "ml"},
	"fluid ounce":  {29.5735, "ml"},
	"fluid ounces": {29.5735, "ml"},
	"pint":         {473.176, "ml"},
	"pints":        {473.176, "ml"},
	"pt":           {473.176, "ml"},
	"quart":        {946.353, "ml"},
	"quarts":       {946.353, "ml"},
	"qt":           {946.353, "ml"},
	"gallon":       {3785.41, "ml"},
	"gallons":      {3785.41, "ml"},
	// weight – imperial
	"oz":      {28.3495, "g"},
	"oz.":     {28.3495, "g"},
	"ounce":   {28.3495, "g"},
	"ounces":  {28.3495, "g"},
	"lb":      {453.592, "g"},
	"lbs":     {453.592, "g"},
	"pound":   {453.592, "g"},
	"pounds":  {453.592, "g"},
	// metric passthrough
	"g":   {1, "g"},
	"gr":  {1, "g"},
	"ml":  {1, "ml"},
	"kg":  {1000, "g"},
	"l":   {1000, "ml"},
	"mg":  {0.001, "g"},
	// dimensionless counts
	"piece":    {1, "piece"},
	"pieces":   {1, "piece"},
	"clove":    {1, "piece"},
	"cloves":   {1, "piece"},
	"head":     {1, "piece"},
	"heads":    {1, "piece"},
	"bunch":    {1, "piece"},
	"bunches":  {1, "piece"},
	"stalk":    {1, "piece"},
	"stalks":   {1, "piece"},
	"sprig":    {1, "piece"},
	"sprigs":   {1, "piece"},
	"slice":    {1, "piece"},
	"slices":   {1, "piece"},
	"can":      {1, "piece"},
	"cans":     {1, "piece"},
	"jar":      {1, "piece"},
	"jars":     {1, "piece"},
	"package":  {1, "piece"},
	"packages": {1, "piece"},
	"pkg":      {1, "piece"},
	"bag":      {1, "piece"},
	"bags":     {1, "piece"},
	// seasoning
	"pinch":  {1, "pinch"},
	"pinches":{1, "pinch"},
	"dash":   {1, "pinch"},
	"dashes": {1, "pinch"},
	"":       {1, ""},
}

// prepMethods are preparation words that describe technique, not the ingredient itself.
var prepMethods = map[string]bool{
	"diced": true, "sliced": true, "cubed": true, "minced": true,
	"chopped": true, "crushed": true, "grated": true, "shredded": true,
	"torn": true, "halved": true, "quartered": true, "peeled": true,
	"pitted": true, "deveined": true, "thawed": true, "toasted": true,
	"roasted": true, "cooked": true, "ground": true, "packed": true,
	"softened": true, "melted": true, "beaten": true, "sifted": true,
	"trimmed": true, "rinsed": true, "drained": true, "crumbled": true,
	"mashed": true, "pureed": true, "zested": true, "divided": true,
	"julienned": true, "blanched": true, "squeezed": true, "whole": true,
	"roughly": true, "finely": true, "thinly": true, "coarsely": true,
}

// unicodeFractionReplacer converts Unicode fraction chars to ASCII equivalents.
var unicodeFractionReplacer = strings.NewReplacer(
	"½", "1/2", "⅓", "1/3", "⅔", "2/3",
	"¼", "1/4", "¾", "3/4", "⅛", "1/8",
	"⅜", "3/8", "⅝", "5/8", "⅞", "7/8",
	"⅙", "1/6", "⅚", "5/6",
)

// priceRe matches price annotations like ($1.50*), $0.99, $1.50**
var priceRe = regexp.MustCompile(`\s*\(\s*\$[\d.,\s]+\*{0,3}\)\s*|\s*\$[\d.]+\*{0,3}`)

// parenSizeRe matches a leading parenthetical size hint like "(15 oz)" or "(about 2 cups)"
var parenSizeRe = regexp.MustCompile(`^\s*\(\s*(?:about\s+|approximately\s+)?[\d./½¼¾⅓⅔⅛⅜⅝⅞]+\s*[a-zA-Z .]+\)\s*`)

// joinedNumUnitRe matches a number glued to a unit with no space, e.g. "200g", "1.5kg", "250ml"
var joinedNumUnitRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)(g|ml|kg|mg|l|oz|lb|lbs)(\b|$)`)

var fractionRe = regexp.MustCompile(`^(\d+)\s*/\s*(\d+)$`)
var numberRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)\s*(\d+\s*/\s*\d+)?`)

func parseFraction(s string) (float64, bool) {
	if m := fractionRe.FindStringSubmatch(strings.TrimSpace(s)); m != nil {
		num, _ := strconv.ParseFloat(m[1], 64)
		den, _ := strconv.ParseFloat(m[2], 64)
		if den == 0 {
			return 0, false
		}
		return num / den, true
	}
	return 0, false
}

func parseLeadingNumber(s string) (float64, string) {
	s = strings.TrimSpace(s)
	// Try "2 1/4" or "1/2" patterns
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return 0, s
	}

	// First token: integer or decimal
	var total float64
	var consumed int

	if v, err := strconv.ParseFloat(parts[0], 64); err == nil {
		total = v
		consumed = 1
		// Check if next token is a fraction
		if len(parts) > 1 {
			if frac, ok := parseFraction(parts[1]); ok {
				total += frac
				consumed = 2
			}
		}
	} else if frac, ok := parseFraction(parts[0]); ok {
		total = frac
		consumed = 1
	} else {
		return 0, s
	}

	rest := strings.Join(parts[consumed:], " ")
	return total, rest
}

// ParseIngredientLine parses e.g. "3 cloves garlic, minced" → {Amount:3, Unit:"piece", Name:"garlic", Notes:"minced"}.
func ParseIngredientLine(line string) models.IngredientInput {
	line = strings.TrimSpace(line)
	if line == "" {
		return models.IngredientInput{}
	}

	// 1. Normalize Unicode fractions (½ → 1/2, etc.) and collapse spaces.
	line = strings.Join(strings.Fields(unicodeFractionReplacer.Replace(line)), " ")

	// 2. Strip price annotations ($1.50, ($0.99*), etc.).
	line = strings.TrimSpace(priceRe.ReplaceAllString(line, " "))
	// Strip trailing asterisks left behind.
	line = strings.TrimRight(line, "* ")

	// 3a. Split joined number+unit like "200g" → "200 g".
	if m := joinedNumUnitRe.FindStringSubmatch(line); m != nil {
		line = m[1] + " " + m[2] + line[len(m[1])+len(m[2]):]
	}

	// 3. Parse leading number.
	amount, rest := parseLeadingNumber(line)

	// 4. Skip parenthetical size hint right after the number, e.g. "(15 oz)" in "1 (15 oz) can chickpeas".
	rest = strings.TrimSpace(parenSizeRe.ReplaceAllString(rest, ""))

	// 5. Extract unit (multi-word first, then single word).
	unitStr, afterUnit := extractUnitWord(rest)

	// 6. Extract leading prep method(s) that come right after the unit,
	//    e.g. "diced" in "2 cups diced tomatoes" → notes="diced", name="tomatoes".
	leadingMethod, afterMethod := extractLeadingMethods(afterUnit)

	// 7. Split on first comma OUTSIDE parens: "garlic, minced" → name="garlic", commaNotes="minced".
	//    Commas inside parens (e.g. "garlic (minced, 1 Tbsp)") are left intact.
	name, commaNotes := splitOnComma(afterMethod)

	// 8. Extract balanced (...) from name; distil prep words from its content.
	//    "Roma tomatoes (diced into 1\" pieces, (1 lb) $1.20*)" → name="Roma tomatoes", parenNote="diced"
	name, parenContent := extractParenthetical(name)
	parenNote := prepFromParenContent(parenContent)

	// 9. Combine all note fragments.
	notes := joinNotes(leadingMethod, commaNotes, parenNote)

	// 10. Convert to metric.
	conv, ok := unitConversions[strings.ToLower(unitStr)]
	var finalAmount float64
	var finalUnit string
	if ok && conv.mult != 0 {
		finalAmount = roundMetric(amount * conv.mult)
		finalUnit = conv.to
	} else {
		finalAmount = amount
		finalUnit = unitStr
	}

	return models.IngredientInput{
		Amount: finalAmount,
		Unit:   finalUnit,
		Name:   strings.TrimSpace(name),
		Notes:  strings.TrimSpace(notes),
	}
}

// roundMetric rounds a converted metric value to a sensible precision:
// ≥ 100 → nearest 5, ≥ 10 → nearest 1, otherwise → 1 decimal place.
func roundMetric(v float64) float64 {
	switch {
	case v >= 100:
		return math.Round(v/5) * 5
	case v >= 10:
		return math.Round(v)
	default:
		return math.Round(v*10) / 10
	}
}

// extractUnitWord strips the leading unit word(s) from s and returns (unit, remainder).
func extractUnitWord(s string) (unit, rest string) {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)

	// Multi-word units take priority.
	multiWord := []string{
		"fl. oz.", "fl. oz", "fl oz",
		"fluid ounces", "fluid ounce",
	}
	for _, u := range multiWord {
		if strings.HasPrefix(lower, u) {
			return s[:len(u)], strings.TrimSpace(s[len(u):])
		}
	}

	// Single-word unit.
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return "", s
	}
	candidate := strings.ToLower(parts[0])
	// Recognised units: anything in the conversion table, plus pass-through units.
	_, inConversions := unitConversions[candidate]
	passThrough := map[string]bool{
		"tsp": true, "tbsp": true,
		"cup": true, "cups": true,
		"tablespoon": true, "tablespoons": true,
		"teaspoon": true, "teaspoons": true,
	}
	if (inConversions || passThrough[candidate]) && candidate != "" {
		return parts[0], strings.TrimSpace(strings.Join(parts[1:], " "))
	}
	return "", s
}

// extractLeadingMethods pulls consecutive prep-method words from the front of s.
func extractLeadingMethods(s string) (methods, rest string) {
	parts := strings.Fields(s)
	var m []string
	i := 0
	for i < len(parts) && prepMethods[strings.ToLower(parts[i])] {
		m = append(m, parts[i])
		i++
	}
	return strings.Join(m, " "), strings.TrimSpace(strings.Join(parts[i:], " "))
}

// splitOnComma splits on the first comma that is NOT inside parentheses.
// "garlic (minced, 1 Tbsp), extra" → name="garlic (minced, 1 Tbsp)", notes="extra"
func splitOnComma(s string) (name, notes string) {
	depth := 0
	for i, ch := range s {
		switch ch {
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		case ',':
			if depth == 0 {
				return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1:])
			}
		}
	}
	return s, ""
}

// extractParenthetical finds the first balanced (...) block in s using depth tracking.
// Returns the string with that block removed, and the block's contents.
func extractParenthetical(s string) (clean, content string) {
	start := -1
	depth := 0
	for i, ch := range s {
		switch ch {
		case '(':
			if depth == 0 {
				start = i
			}
			depth++
		case ')':
			depth--
			if depth == 0 && start >= 0 {
				content = strings.TrimSpace(s[start+1 : i])
				clean = strings.TrimSpace(s[:start]+" "+s[i+1:])
				clean = strings.Join(strings.Fields(clean), " ")
				return clean, content
			}
		}
	}
	// Unmatched open paren — strip everything from it onward
	if start >= 0 {
		return strings.TrimSpace(s[:start]), ""
	}
	return s, ""
}

// prepFromParenContent extracts leading prep-method words from paren content,
// discarding imperial equivalents, prices, and other non-prep info.
// "minced, (1 Tbsp) $0.30"  → "minced"
// "diced into 1\" pieces, (1 lb) $1.20*" → "diced"
// "half a box, (uncooked) $0.53" → "" (half is not a prep method)
func prepFromParenContent(content string) string {
	// Strip nested parens and their contents entirely.
	for {
		s := strings.Index(content, "(")
		if s == -1 {
			break
		}
		e := strings.Index(content[s:], ")")
		if e == -1 {
			content = content[:s]
			break
		}
		content = strings.TrimSpace(content[:s] + " " + content[s+e+1:])
	}
	// Take only the part before the first comma.
	if idx := strings.Index(content, ","); idx != -1 {
		content = content[:idx]
	}
	// Strip prices.
	content = strings.TrimSpace(priceRe.ReplaceAllString(content, " "))
	content = strings.TrimRight(content, "* ")
	// Collect leading prep-method words.
	parts := strings.Fields(content)
	var methods []string
	for _, p := range parts {
		if prepMethods[strings.ToLower(p)] {
			methods = append(methods, p)
		} else {
			break
		}
	}
	return strings.Join(methods, " ")
}

// joinNotes joins non-empty note fragments with ", ".
func joinNotes(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, ", ")
}

// ParseISO8601Duration parses "PT1H30M" → 90 minutes.
func ParseISO8601Duration(s string) int {
	s = strings.ToUpper(s)
	if !strings.HasPrefix(s, "PT") && !strings.HasPrefix(s, "P") {
		return 0
	}

	s = strings.TrimPrefix(s, "PT")
	if strings.HasPrefix(s, "P") {
		s = strings.TrimPrefix(s, "P")
	}

	total := 0
	// Days
	if idx := strings.Index(s, "D"); idx != -1 {
		if v, err := strconv.Atoi(s[:idx]); err == nil {
			total += v * 24 * 60
		}
		s = s[idx+1:]
		s = strings.TrimPrefix(s, "T")
	}
	// Hours
	if idx := strings.Index(s, "H"); idx != -1 {
		if v, err := strconv.Atoi(s[:idx]); err == nil {
			total += v * 60
		}
		s = s[idx+1:]
	}
	// Minutes
	if idx := strings.Index(s, "M"); idx != -1 {
		if v, err := strconv.Atoi(s[:idx]); err == nil {
			total += v
		}
	}
	return total
}

// jsonLDRecipe is the minimal JSON-LD Recipe schema we care about.
type jsonLDRecipe struct {
	Type        interface{} `json:"@type"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Image       interface{} `json:"image"`
	PrepTime    string      `json:"prepTime"`
	CookTime    string      `json:"cookTime"`
	TotalTime   string      `json:"totalTime"`
	RecipeYield interface{} `json:"recipeYield"`
	RecipeIngredient []string `json:"recipeIngredient"`
	RecipeInstructions interface{} `json:"recipeInstructions"`
}

func ExtractJSONLD(body string) (*models.CreateRecipeRequest, error) {
	tokenizer := html.NewTokenizer(strings.NewReader(body))
	var scripts []string
	for {
		tt := tokenizer.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt == html.StartTagToken {
			name, hasAttr := tokenizer.TagName()
			if string(name) == "script" && hasAttr {
				var isJSONLD bool
				for {
					key, val, more := tokenizer.TagAttr()
					if string(key) == "type" && string(val) == "application/ld+json" {
						isJSONLD = true
					}
					if !more {
						break
					}
				}
				if isJSONLD {
					tokenizer.Next()
					scripts = append(scripts, string(tokenizer.Text()))
				}
			}
		}
	}

	for _, script := range scripts {
		req := tryParseJSONLD(script)
		if req != nil {
			return req, nil
		}
	}
	return nil, fmt.Errorf("no JSON-LD recipe found")
}

func tryParseJSONLD(raw string) *models.CreateRecipeRequest {
	// Could be an object or array
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "[") {
		var arr []json.RawMessage
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return nil
		}
		for _, item := range arr {
			if req := tryParseJSONLD(string(item)); req != nil {
				return req
			}
		}
		return nil
	}

	var rec jsonLDRecipe
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return nil
	}

	// Check @type
	typeStr := ""
	switch v := rec.Type.(type) {
	case string:
		typeStr = v
	case []interface{}:
		for _, t := range v {
			if s, ok := t.(string); ok {
				typeStr = s
				break
			}
		}
	}
	if !strings.Contains(strings.ToLower(typeStr), "recipe") {
		// Could be a graph
		var graph struct {
			Graph []json.RawMessage `json:"@graph"`
		}
		if err := json.Unmarshal([]byte(raw), &graph); err == nil {
			for _, item := range graph.Graph {
				if req := tryParseJSONLD(string(item)); req != nil {
					return req
				}
			}
		}
		return nil
	}

	req := &models.CreateRecipeRequest{
		Title:        rec.Name,
		Description:  rec.Description,
		PrepTime:     ParseISO8601Duration(rec.PrepTime),
		CookTime:     ParseISO8601Duration(rec.CookTime),
		BaseServings: parseServings(rec.RecipeYield),
	}

	// Image
	switch v := rec.Image.(type) {
	case string:
		req.ImageURL = v
	case map[string]interface{}:
		if u, ok := v["url"].(string); ok {
			req.ImageURL = u
		}
	case []interface{}:
		if len(v) > 0 {
			if s, ok := v[0].(string); ok {
				req.ImageURL = s
			}
		}
	}

	// Ingredients
	for _, line := range rec.RecipeIngredient {
		req.Ingredients = append(req.Ingredients, ParseIngredientLine(line))
	}

	// Steps
	req.Steps = parseInstructions(rec.RecipeInstructions)

	if req.BaseServings == 0 {
		req.BaseServings = 4
	}
	return req
}

func parseServings(v interface{}) int {
	switch s := v.(type) {
	case string:
		// "4 servings" or "4"
		fields := strings.Fields(s)
		if len(fields) > 0 {
			if n, err := strconv.Atoi(fields[0]); err == nil {
				return n
			}
		}
	case float64:
		return int(s)
	case []interface{}:
		if len(s) > 0 {
			return parseServings(s[0])
		}
	}
	return 4
}

func parseInstructions(v interface{}) []models.StepInput {
	var steps []models.StepInput
	switch inst := v.(type) {
	case string:
		// Plain text, split by ". " or newline
		lines := strings.Split(inst, "\n")
		for i, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" {
				steps = append(steps, models.StepInput{StepNumber: i + 1, Instruction: line})
			}
		}
	case []interface{}:
		num := 1
		for _, item := range inst {
			switch s := item.(type) {
			case string:
				steps = append(steps, models.StepInput{StepNumber: num, Instruction: strings.TrimSpace(s)})
				num++
			case map[string]interface{}:
				text := ""
				if t, ok := s["text"].(string); ok {
					text = t
				}
				if text == "" {
					if n, ok := s["name"].(string); ok {
						text = n
					}
				}
				if text != "" {
					steps = append(steps, models.StepInput{StepNumber: num, Instruction: strings.TrimSpace(text)})
					num++
				}
			}
		}
	}
	return steps
}
