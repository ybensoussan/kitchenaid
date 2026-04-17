package db

import (
	"database/sql"
	"fmt"
	"kitchenaid/internal/models"
	"strings"
)

// ListMealPlans returns all plans ordered by week_start desc.
func (s *Store) ListMealPlans() ([]models.MealPlan, error) {
	rows, err := s.db.Query(`SELECT id, name, week_start, created_at FROM meal_plans ORDER BY week_start DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var plans []models.MealPlan
	for rows.Next() {
		var p models.MealPlan
		if err := rows.Scan(&p.ID, &p.Name, &p.WeekStart, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.Entries = []models.MealPlanEntry{}
		plans = append(plans, p)
	}
	if plans == nil {
		plans = []models.MealPlan{}
	}
	return plans, rows.Err()
}

// CreateMealPlan inserts a new plan and returns it.
func (s *Store) CreateMealPlan(name, weekStart string) (*models.MealPlan, error) {
	res, err := s.db.Exec(`INSERT INTO meal_plans (name, week_start) VALUES (?, ?)`, name, weekStart)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetMealPlan(id)
}

// GetMealPlan returns a plan with all its entries (including recipe title/image).
func (s *Store) GetMealPlan(id int64) (*models.MealPlan, error) {
	var p models.MealPlan
	err := s.db.QueryRow(`SELECT id, name, week_start, created_at FROM meal_plans WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.WeekStart, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT e.id, e.meal_plan_id, e.recipe_id, r.title, r.image_url, e.day, e.meal_type, e.servings
		FROM meal_plan_entries e
		JOIN recipes r ON r.id = e.recipe_id
		WHERE e.meal_plan_id = ?
		ORDER BY e.day, e.meal_type`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	p.Entries = []models.MealPlanEntry{}
	for rows.Next() {
		var e models.MealPlanEntry
		if err := rows.Scan(&e.ID, &e.MealPlanID, &e.RecipeID, &e.RecipeTitle, &e.RecipeImage, &e.Day, &e.MealType, &e.Servings); err != nil {
			return nil, err
		}
		p.Entries = append(p.Entries, e)
	}
	return &p, rows.Err()
}

// DeleteMealPlan deletes a plan (entries cascade).
func (s *Store) DeleteMealPlan(id int64) error {
	_, err := s.db.Exec(`DELETE FROM meal_plans WHERE id = ?`, id)
	return err
}

// AddMealPlanEntry adds a recipe to a plan slot.
func (s *Store) AddMealPlanEntry(planID, recipeID int64, day, mealType string, servings int) (*models.MealPlanEntry, error) {
	res, err := s.db.Exec(`
		INSERT INTO meal_plan_entries (meal_plan_id, recipe_id, day, meal_type, servings)
		VALUES (?, ?, ?, ?, ?)`, planID, recipeID, day, mealType, servings)
	if err != nil {
		return nil, err
	}
	entryID, _ := res.LastInsertId()

	var e models.MealPlanEntry
	err = s.db.QueryRow(`
		SELECT e.id, e.meal_plan_id, e.recipe_id, r.title, r.image_url, e.day, e.meal_type, e.servings
		FROM meal_plan_entries e
		JOIN recipes r ON r.id = e.recipe_id
		WHERE e.id = ?`, entryID).
		Scan(&e.ID, &e.MealPlanID, &e.RecipeID, &e.RecipeTitle, &e.RecipeImage, &e.Day, &e.MealType, &e.Servings)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// DeleteMealPlanEntry removes an entry.
func (s *Store) DeleteMealPlanEntry(entryID, planID int64) error {
	_, err := s.db.Exec(`DELETE FROM meal_plan_entries WHERE id = ? AND meal_plan_id = ?`, entryID, planID)
	return err
}

// GetGroceryList aggregates all ingredients from all recipes in a plan.
// When an ingredient is linked to a pantry item, the pantry item name is used
// as the display name and grouping key (prevents duplicates like "onion"/"onions").
// Unlinked ingredients are grouped by lowercase name + unit.
func (s *Store) GetGroceryList(planID int64) ([]models.GroceryItem, error) {
	rows, err := s.db.Query(`
		SELECT
			COALESCE(p.name, i.name) AS display_name,
			i.pantry_item_id,
			i.amount, i.unit, r.title, e.servings,
			COALESCE(p.image_url, '') AS pantry_image_url
		FROM meal_plan_entries e
		JOIN recipes r ON r.id = e.recipe_id
		JOIN ingredients i ON i.recipe_id = r.id
		LEFT JOIN pantry_items p ON p.id = i.pantry_item_id
		WHERE e.meal_plan_id = ?
		ORDER BY display_name, i.unit`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type key struct {
		id   string // pantry_item_id as string, or "name:unit" for unlinked
		unit string
	}
	type agg struct {
		displayName string
		amount      float64
		imageURL    string
		recipes     map[string]struct{}
	}
	order := []key{}
	groups := map[key]*agg{}

	for rows.Next() {
		var displayName, unit, recipeTitle, pantryImageURL string
		var pantryItemID sql.NullInt64
		var amount float64
		var multiplier int
		if err := rows.Scan(&displayName, &pantryItemID, &amount, &unit, &recipeTitle, &multiplier, &pantryImageURL); err != nil {
			return nil, err
		}
		if multiplier < 1 || multiplier > 4 {
			multiplier = 1
		}
		scaled := amount * float64(multiplier)

		var k key
		if pantryItemID.Valid {
			k = key{id: fmt.Sprintf("p:%d", pantryItemID.Int64), unit: unit}
		} else {
			k = key{id: "n:" + strings.ToLower(displayName), unit: unit}
		}

		if g, ok := groups[k]; ok {
			g.amount += scaled
			g.recipes[recipeTitle] = struct{}{}
			if g.imageURL == "" && pantryImageURL != "" {
				g.imageURL = pantryImageURL
			}
		} else {
			order = append(order, k)
			groups[k] = &agg{
				displayName: displayName,
				amount:      scaled,
				imageURL:    pantryImageURL,
				recipes:     map[string]struct{}{recipeTitle: {}},
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	items := make([]models.GroceryItem, 0, len(order))
	for _, k := range order {
		g := groups[k]
		recipeTitles := make([]string, 0, len(g.recipes))
		for rt := range g.recipes {
			recipeTitles = append(recipeTitles, rt)
		}
		items = append(items, models.GroceryItem{
			Name:     g.displayName,
			Amount:   g.amount,
			Unit:     k.unit,
			Recipes:  recipeTitles,
			ImageURL: g.imageURL,
		})
	}
	if items == nil {
		items = []models.GroceryItem{}
	}
	return items, nil
}
