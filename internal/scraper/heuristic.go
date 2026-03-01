package scraper

import (
	"strings"

	"golang.org/x/net/html"
	"kitchenaid/internal/models"
)

// extractGenericHTML is a DOM-walk fallback for recipe blog posts that use
// plain HTML instead of structured data (JSON-LD, microdata, recipe plugins).
// It looks for section headings or short bold markers such as "Ingredients" /
// "Directions" and collects the content that follows as <ul>/<li> items or
// <br>-separated text lines.
func extractGenericHTML(body, sourceURL string) *models.CreateRecipeRequest {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return nil
	}

	title := genericPageTitle(doc)
	if title == "" {
		return nil
	}

	ings := genericFindSection(doc, []string{"ingredient"})
	steps := genericFindSection(doc, []string{"instruction", "direction", "method"})
	if len(ings) == 0 && len(steps) == 0 {
		return nil
	}

	req := &models.CreateRecipeRequest{
		Title:        title,
		SourceURL:    sourceURL,
		BaseServings: 4,
	}
	for _, line := range ings {
		// Skip servings annotations like "Serves 8" or "Makes 4 servings"
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "serves ") || strings.HasPrefix(lower, "makes ") ||
			strings.HasPrefix(lower, "yield") || strings.HasPrefix(lower, "servings") {
			continue
		}
		ing := ParseIngredientLine(line)
		if ing.Name != "" {
			req.Ingredients = append(req.Ingredients, ing)
		}
	}
	for i, step := range steps {
		req.Steps = append(req.Steps, models.StepInput{StepNumber: i + 1, Instruction: step})
	}
	return req
}

// genericPageTitle extracts the post/recipe title from the DOM.
// Priority: class="post-title"/"entry-title" → first <h1> → <title> (suffix stripped).
func genericPageTitle(doc *html.Node) string {
	// Common blog post title classes (Blogger, WordPress, Ghost, etc.)
	titleClasses := []string{"post-title", "entry-title", "recipe-title", "article-title"}
	var byClass string
	var walkForClass func(*html.Node)
	walkForClass = func(n *html.Node) {
		if byClass != "" {
			return
		}
		if n.Type == html.ElementNode {
			for _, cls := range titleClasses {
				if nodeHasClass(n, cls) {
					if t := nodeTextContent(n); t != "" {
						byClass = t
						return
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walkForClass(c)
		}
	}
	walkForClass(doc)
	if byClass != "" {
		return byClass
	}

	// First <h1> in the document
	if h1 := findFirstNodeByTag(doc, "h1"); h1 != nil {
		if t := nodeTextContent(h1); t != "" {
			return t
		}
	}

	// Fall back to <title>, stripping common " | Site Name" suffixes
	if tn := findFirstNodeByTag(doc, "title"); tn != nil {
		full := nodeTextContent(tn)
		for _, sep := range []string{" | ", " – ", " — ", " - "} {
			if idx := strings.LastIndex(full, sep); idx > 0 {
				return strings.TrimSpace(full[:idx])
			}
		}
		return full
	}
	return ""
}

// sectionStopWords are recipe-section heading words; used to decide whether a
// short <b>/<strong> tag counts as a section break.
var sectionStopWords = []string{
	"ingredient", "direction", "instruction", "method", "step",
	"note", "tip", "equipment", "nutrition", "serving",
}

// genericFindSection locates a recipe section by keywords and returns its lines.
// It collects markers (h1-h5 and short bold/strong elements with section keywords),
// finds the first one matching `keywords`, then collects what follows until the
// next marker.
func genericFindSection(doc *html.Node, keywords []string) []string {
	// Walk the whole document and collect "section marker" nodes in order.
	var markers []*html.Node
	var collect func(*html.Node)
	collect = func(n *html.Node) {
		if n.Type == html.ElementNode {
			tag := strings.ToLower(n.Data)
			isHeading := tag == "h1" || tag == "h2" || tag == "h3" || tag == "h4" || tag == "h5"
			isBold := tag == "b" || tag == "strong"
			if isHeading {
				markers = append(markers, n)
			} else if isBold {
				// Only treat bold as a section marker if it's short (≤ 4 words) and
				// contains a known section keyword.  This avoids treating bold
				// ingredient amounts like "<b>3 cans</b>" as section headers.
				text := strings.ToLower(nodeTextContent(n))
				words := strings.Fields(text)
				if len(words) <= 4 && keywordInText(text, sectionStopWords) {
					markers = append(markers, n)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			collect(c)
		}
	}
	collect(doc)

	// Find the first marker matching the target keywords.
	var target *html.Node
	for _, m := range markers {
		if keywordInText(strings.ToLower(nodeTextContent(m)), keywords) {
			target = m
			break
		}
	}
	if target == nil {
		return nil
	}

	// Build a stop set of all OTHER markers.
	stopSet := make(map[*html.Node]bool, len(markers))
	for _, m := range markers {
		if m != target {
			stopSet[m] = true
		}
	}

	return collectSectionContent(target, stopSet)
}

// collectSectionContent collects text lines following a section-marker node.
// It handles two layouts:
//   - <ul>/<ol> + <li> items  (structured list)
//   - <br>-separated plain text (old-style Blogger / hand-coded HTML)
//
// Collection stops when a stopSet node or a heading element is encountered.
func collectSectionContent(marker *html.Node, stopSet map[*html.Node]bool) []string {
	var items []string
	var pending strings.Builder

	flush := func() {
		if line := strings.TrimSpace(pending.String()); line != "" {
			items = append(items, line)
		}
		pending.Reset()
	}

	var walkSiblings func(*html.Node)
	walkSiblings = func(start *html.Node) {
		for sib := start; sib != nil; sib = sib.NextSibling {
			// Hit a stop marker → done.
			if stopSet[sib] {
				flush()
				return
			}
			if sib.Type == html.TextNode {
				text := strings.TrimSpace(sib.Data)
				if text != "" {
					if pending.Len() > 0 {
						pending.WriteString(" ")
					}
					pending.WriteString(text)
				}
				continue
			}
			if sib.Type != html.ElementNode {
				continue
			}
			switch strings.ToLower(sib.Data) {
			case "br":
				flush()
			case "ul", "ol":
				flush()
				for c := sib.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.ElementNode && strings.ToLower(c.Data) == "li" {
						if t := strings.TrimSpace(nodeTextContent(c)); t != "" {
							items = append(items, t)
						}
					}
				}
				return // list found — we're done
			case "h1", "h2", "h3", "h4", "h5", "h6":
				flush()
				return // heading starts a new section
			case "p":
				flush()
				if t := strings.TrimSpace(nodeTextContent(sib)); t != "" {
					items = append(items, t)
				}
			default:
				// Inline element (span, a, em, b not in stopSet, etc.) — get text
				if t := strings.TrimSpace(nodeTextContent(sib)); t != "" {
					if pending.Len() > 0 {
						pending.WriteString(" ")
					}
					pending.WriteString(t)
				}
			}
		}
		flush()
	}

	walkSiblings(marker.NextSibling)

	// If nothing collected, the marker might itself be inside a heading; try
	// looking at the heading's next sibling instead.
	if len(items) == 0 && marker.Parent != nil && marker.Parent.Type == html.ElementNode {
		pTag := strings.ToLower(marker.Parent.Data)
		if pTag == "h1" || pTag == "h2" || pTag == "h3" || pTag == "h4" || pTag == "h5" {
			walkSiblings(marker.Parent.NextSibling)
		}
	}

	return items
}

// keywordInText returns true if text contains any of the keywords.
func keywordInText(text string, keywords []string) bool {
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

// nodeTextContent returns the concatenated text content of a node tree.
func nodeTextContent(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			sb.WriteString(node.Data)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.TrimSpace(strings.Join(strings.Fields(sb.String()), " "))
}

// findFirstNodeByTag returns the first node with the given tag in a depth-first walk.
func findFirstNodeByTag(n *html.Node, tag string) *html.Node {
	if n.Type == html.ElementNode && strings.ToLower(n.Data) == tag {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findFirstNodeByTag(c, tag); found != nil {
			return found
		}
	}
	return nil
}

// nodeHasClass returns true if the node's class attribute contains the given class name.
func nodeHasClass(n *html.Node, class string) bool {
	for _, a := range n.Attr {
		if a.Key == "class" {
			for _, c := range strings.Fields(a.Val) {
				if strings.EqualFold(c, class) {
					return true
				}
			}
		}
	}
	return false
}
