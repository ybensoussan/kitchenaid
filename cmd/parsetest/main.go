package main

import (
	"fmt"
	"kitchenaid/internal/scraper"
)

func main() {
	cases := []string{
		// Real Budget Bytes strings
		`5  Roma tomatoes (diced into 1" pieces, (1 lb 5 oz, 4 cups) $1.20*)`,
		`3  garlic cloves (minced, (1 Tbsp) $0.30)`,
		`½  yellow onion (diced, (1/2 cup) $0.35)`,
		`1 Tbsp fresh parsley (minced, $0.09)`,
		`½ tsp salt ($0.01)`,
		`¼ tsp black pepper (ground, $0.01)`,
		`7 oz. block feta ($5.44**)`,
		`½ cup olive oil ($1.50)`,
		`8 oz. rotini pasta (half a box, (uncooked) $0.53)`,
		`1 cup fresh spinach (packed, $0.46***)`,
		`0.25 oz. fresh basil (torn, $0.89)`,
		// Generic cases
		`3 cloves garlic, minced`,
		`2 cups diced tomatoes`,
		`½ cup butter, softened`,
		`1 (15 oz) can chickpeas, drained and rinsed`,
		`200g cream cheese, softened`,
		`1 lb chicken breast, boneless and skinless`,
		`1 tablespoon olive oil`,
		`2 teaspoons dried oregano`,
		`100tbsp of something`,
	}
	fmt.Printf("%-52s  %7s  %-8s  %-22s  %s\n", "INPUT", "AMOUNT", "UNIT", "NAME", "NOTES")
	fmt.Println(fmt.Sprintf("%s", "────────────────────────────────────────────────────────────────────────────────────────────────────────"))
	for _, c := range cases {
		r := scraper.ParseIngredientLine(c)
		fmt.Printf("%-52s  %7.2f  %-8s  %-22s  %s\n", c[:min(52, len(c))], r.Amount, r.Unit, r.Name, r.Notes)
	}
}
func min(a, b int) int { if a < b { return a }; return b }
