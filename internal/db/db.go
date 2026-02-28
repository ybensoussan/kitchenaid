package db

import (
	"database/sql"
	"fmt"
	"kitchenaid/internal/models"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func New(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Additive column migrations — errors are swallowed because the column
	// may already exist (SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS).
	for _, stmt := range []string{
		`ALTER TABLE pantry_items ADD COLUMN amount REAL    NOT NULL DEFAULT 0`,
		`ALTER TABLE pantry_items ADD COLUMN unit   TEXT    NOT NULL DEFAULT ''`,
		`ALTER TABLE pantry_items ADD COLUMN notes  TEXT    NOT NULL DEFAULT ''`,
	} {
		s.db.Exec(stmt) //nolint:errcheck
	}
	return nil
}

// ── Recipes ──────────────────────────────────────────────────────────────────

func (s *Store) ListRecipes() ([]models.Recipe, error) {
	rows, err := s.db.Query(`
		SELECT id, title, description, image_url, prep_time, cook_time,
		       base_servings, source_url, created_at, updated_at
		FROM recipes ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recipes []models.Recipe
	for rows.Next() {
		var r models.Recipe
		if err := rows.Scan(&r.ID, &r.Title, &r.Description, &r.ImageURL,
			&r.PrepTime, &r.CookTime, &r.BaseServings, &r.SourceURL,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		recipes = append(recipes, r)
	}
	return recipes, rows.Err()
}

func (s *Store) GetRecipe(id int64) (*models.Recipe, error) {
	r := &models.Recipe{}
	err := s.db.QueryRow(`
		SELECT id, title, description, image_url, prep_time, cook_time,
		       base_servings, source_url, created_at, updated_at
		FROM recipes WHERE id = ?`, id).Scan(
		&r.ID, &r.Title, &r.Description, &r.ImageURL,
		&r.PrepTime, &r.CookTime, &r.BaseServings, &r.SourceURL,
		&r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	r.Ingredients, err = s.GetIngredients(id)
	if err != nil {
		return nil, err
	}
	r.Steps, err = s.GetSteps(id)
	return r, err
}

func (s *Store) CreateRecipe(req models.CreateRecipeRequest) (*models.Recipe, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if req.BaseServings == 0 {
		req.BaseServings = 4
	}

	res, err := tx.Exec(`
		INSERT INTO recipes (title, description, image_url, prep_time, cook_time, base_servings, source_url)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.Title, req.Description, req.ImageURL, req.PrepTime, req.CookTime, req.BaseServings, req.SourceURL)
	if err != nil {
		return nil, err
	}
	recipeID, _ := res.LastInsertId()

	for i, ing := range req.Ingredients {
		if ing.SortOrder == 0 {
			ing.SortOrder = i
		}
		_, err = tx.Exec(`INSERT INTO ingredients (recipe_id, sort_order, name, amount, unit, notes) VALUES (?, ?, ?, ?, ?, ?)`,
			recipeID, ing.SortOrder, ing.Name, ing.Amount, ing.Unit, ing.Notes)
		if err != nil {
			return nil, err
		}
	}

	for i, step := range req.Steps {
		if step.StepNumber == 0 {
			step.StepNumber = i + 1
		}
		_, err = tx.Exec(`INSERT INTO steps (recipe_id, step_number, instruction, duration) VALUES (?, ?, ?, ?)`,
			recipeID, step.StepNumber, step.Instruction, step.Duration)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetRecipe(recipeID)
}

func (s *Store) UpdateRecipe(id int64, req models.CreateRecipeRequest) (*models.Recipe, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if req.BaseServings == 0 {
		req.BaseServings = 4
	}

	_, err = tx.Exec(`
		UPDATE recipes SET title=?, description=?, image_url=?, prep_time=?, cook_time=?,
		                   base_servings=?, source_url=?, updated_at=CURRENT_TIMESTAMP
		WHERE id=?`,
		req.Title, req.Description, req.ImageURL, req.PrepTime, req.CookTime, req.BaseServings, req.SourceURL, id)
	if err != nil {
		return nil, err
	}

	tx.Exec(`DELETE FROM ingredients WHERE recipe_id=?`, id)
	tx.Exec(`DELETE FROM steps WHERE recipe_id=?`, id)

	for i, ing := range req.Ingredients {
		if ing.SortOrder == 0 {
			ing.SortOrder = i
		}
		_, err = tx.Exec(`INSERT INTO ingredients (recipe_id, sort_order, name, amount, unit, notes) VALUES (?, ?, ?, ?, ?, ?)`,
			id, ing.SortOrder, ing.Name, ing.Amount, ing.Unit, ing.Notes)
		if err != nil {
			return nil, err
		}
	}

	for i, step := range req.Steps {
		if step.StepNumber == 0 {
			step.StepNumber = i + 1
		}
		_, err = tx.Exec(`INSERT INTO steps (recipe_id, step_number, instruction, duration) VALUES (?, ?, ?, ?)`,
			id, step.StepNumber, step.Instruction, step.Duration)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetRecipe(id)
}

var patchAllowlist = map[string]bool{
	"title": true, "description": true, "image_url": true,
	"prep_time": true, "cook_time": true, "base_servings": true,
}

func (s *Store) PatchRecipe(id int64, field string, value interface{}) error {
	if !patchAllowlist[field] {
		return fmt.Errorf("field %q not patchable", field)
	}
	col := field
	_, err := s.db.Exec(
		fmt.Sprintf(`UPDATE recipes SET %s=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, col),
		value, id)
	return err
}

func (s *Store) DeleteRecipe(id int64) error {
	_, err := s.db.Exec(`DELETE FROM recipes WHERE id=?`, id)
	return err
}

// ── Ingredients ──────────────────────────────────────────────────────────────

func (s *Store) GetIngredients(recipeID int64) ([]models.Ingredient, error) {
	rows, err := s.db.Query(`
		SELECT id, recipe_id, sort_order, name, amount, unit, notes
		FROM ingredients WHERE recipe_id=? ORDER BY sort_order`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ings []models.Ingredient
	for rows.Next() {
		var ing models.Ingredient
		if err := rows.Scan(&ing.ID, &ing.RecipeID, &ing.SortOrder, &ing.Name, &ing.Amount, &ing.Unit, &ing.Notes); err != nil {
			return nil, err
		}
		ings = append(ings, ing)
	}
	return ings, rows.Err()
}

func (s *Store) AddIngredient(recipeID int64, inp models.IngredientInput) (*models.Ingredient, error) {
	res, err := s.db.Exec(`
		INSERT INTO ingredients (recipe_id, sort_order, name, amount, unit, notes)
		VALUES (?, ?, ?, ?, ?, ?)`,
		recipeID, inp.SortOrder, inp.Name, inp.Amount, inp.Unit, inp.Notes)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.Ingredient{
		ID: id, RecipeID: recipeID, SortOrder: inp.SortOrder,
		Name: inp.Name, Amount: inp.Amount, Unit: inp.Unit, Notes: inp.Notes,
	}, nil
}

func (s *Store) UpdateIngredient(id, recipeID int64, inp models.IngredientInput) (*models.Ingredient, error) {
	_, err := s.db.Exec(`
		UPDATE ingredients SET sort_order=?, name=?, amount=?, unit=?, notes=?
		WHERE id=? AND recipe_id=?`,
		inp.SortOrder, inp.Name, inp.Amount, inp.Unit, inp.Notes, id, recipeID)
	if err != nil {
		return nil, err
	}
	return &models.Ingredient{
		ID: id, RecipeID: recipeID, SortOrder: inp.SortOrder,
		Name: inp.Name, Amount: inp.Amount, Unit: inp.Unit, Notes: inp.Notes,
	}, nil
}

func (s *Store) DeleteIngredient(id, recipeID int64) error {
	_, err := s.db.Exec(`DELETE FROM ingredients WHERE id=? AND recipe_id=?`, id, recipeID)
	return err
}

func (s *Store) ReorderIngredients(recipeID int64, ids []int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		_, err = tx.Exec(`UPDATE ingredients SET sort_order=? WHERE id=? AND recipe_id=?`, i, id, recipeID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ── Steps ─────────────────────────────────────────────────────────────────────

func (s *Store) GetSteps(recipeID int64) ([]models.Step, error) {
	rows, err := s.db.Query(`
		SELECT id, recipe_id, step_number, instruction, duration
		FROM steps WHERE recipe_id=? ORDER BY step_number`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []models.Step
	for rows.Next() {
		var st models.Step
		if err := rows.Scan(&st.ID, &st.RecipeID, &st.StepNumber, &st.Instruction, &st.Duration); err != nil {
			return nil, err
		}
		steps = append(steps, st)
	}
	return steps, rows.Err()
}

func (s *Store) AddStep(recipeID int64, inp models.StepInput) (*models.Step, error) {
	res, err := s.db.Exec(`
		INSERT INTO steps (recipe_id, step_number, instruction, duration) VALUES (?, ?, ?, ?)`,
		recipeID, inp.StepNumber, inp.Instruction, inp.Duration)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.Step{
		ID: id, RecipeID: recipeID, StepNumber: inp.StepNumber,
		Instruction: inp.Instruction, Duration: inp.Duration,
	}, nil
}

func (s *Store) UpdateStep(id, recipeID int64, inp models.StepInput) (*models.Step, error) {
	_, err := s.db.Exec(`
		UPDATE steps SET step_number=?, instruction=?, duration=?
		WHERE id=? AND recipe_id=?`,
		inp.StepNumber, inp.Instruction, inp.Duration, id, recipeID)
	if err != nil {
		return nil, err
	}
	return &models.Step{
		ID: id, RecipeID: recipeID, StepNumber: inp.StepNumber,
		Instruction: inp.Instruction, Duration: inp.Duration,
	}, nil
}

func (s *Store) DeleteStep(id, recipeID int64) error {
	_, err := s.db.Exec(`DELETE FROM steps WHERE id=? AND recipe_id=?`, id, recipeID)
	return err
}

// buildPlaceholders returns "(?,?,?)" for n items
func buildPlaceholders(n int) string {
	ph := make([]string, n)
	for i := range ph {
		ph[i] = "?"
	}
	return "(" + strings.Join(ph, ",") + ")"
}
