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

func (s *Store) Reopen(dsn string) error {
	db, err := sql.Open("sqlite", dsn+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}
	s.db = db
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
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
		`ALTER TABLE recipes ADD COLUMN favorited  INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE recipes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE pantry_items ADD COLUMN price           REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE pantry_items ADD COLUMN price_unit_size TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE ingredients ADD COLUMN pantry_item_id INTEGER REFERENCES pantry_items(id) ON DELETE SET NULL`,
		`ALTER TABLE pantry_items ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`,
	} {
		s.db.Exec(stmt) //nolint:errcheck
	}
	return nil
}

// ── Recipes ──────────────────────────────────────────────────────────────────

func (s *Store) ListRecipes(tagFilter string) ([]models.Recipe, error) {
	var query string
	var args []interface{}

	if tagFilter != "" {
		query = `
			SELECT r.id, r.title, r.description, r.image_url, r.prep_time, r.cook_time,
			       r.base_servings, r.source_url, r.favorited, r.created_at, r.updated_at
			FROM recipes r
			JOIN recipe_tags rt ON r.id = rt.recipe_id
			JOIN tags t ON rt.tag_id = t.id
			WHERE t.name = ?
			ORDER BY r.sort_order ASC, r.id DESC`
		args = append(args, strings.ToLower(tagFilter))
	} else {
		query = `
			SELECT id, title, description, image_url, prep_time, cook_time,
			       base_servings, source_url, favorited, created_at, updated_at
			FROM recipes ORDER BY sort_order ASC, id DESC`
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recipes []models.Recipe
	for rows.Next() {
		var r models.Recipe
		if err := rows.Scan(&r.ID, &r.Title, &r.Description, &r.ImageURL,
			&r.PrepTime, &r.CookTime, &r.BaseServings, &r.SourceURL,
			&r.Favorited, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		recipes = append(recipes, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close() // release connection before issuing more queries

	for i := range recipes {
		recipes[i].Tags, _ = s.GetRecipeTags(recipes[i].ID)
	}
	return recipes, nil
}

func (s *Store) GetRecipe(id int64) (*models.Recipe, error) {
	r := &models.Recipe{}
	err := s.db.QueryRow(`
		SELECT id, title, description, image_url, prep_time, cook_time,
		       base_servings, source_url, favorited, created_at, updated_at
		FROM recipes WHERE id = ?`, id).Scan(
		&r.ID, &r.Title, &r.Description, &r.ImageURL,
		&r.PrepTime, &r.CookTime, &r.BaseServings, &r.SourceURL,
		&r.Favorited, &r.CreatedAt, &r.UpdatedAt)
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
	if err != nil {
		return nil, err
	}
	r.Tags, err = s.GetRecipeTags(id)
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
	"favorited": true,
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

func (s *Store) ReorderRecipes(ids []int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err = tx.Exec(`UPDATE recipes SET sort_order=? WHERE id=?`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ── Ingredients ──────────────────────────────────────────────────────────────

func (s *Store) GetIngredients(recipeID int64) ([]models.Ingredient, error) {
	rows, err := s.db.Query(`
		SELECT id, recipe_id, sort_order, name, amount, unit, notes, pantry_item_id
		FROM ingredients WHERE recipe_id=? ORDER BY sort_order`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ings []models.Ingredient
	for rows.Next() {
		var ing models.Ingredient
		if err := rows.Scan(&ing.ID, &ing.RecipeID, &ing.SortOrder, &ing.Name, &ing.Amount, &ing.Unit, &ing.Notes, &ing.PantryItemID); err != nil {
			return nil, err
		}
		ings = append(ings, ing)
	}
	return ings, rows.Err()
}

// GetRecipesByPantryItem returns the distinct recipe titles that link to a pantry item.
func (s *Store) GetRecipesByPantryItem(pantryItemID int64) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT DISTINCT r.title
		FROM ingredients i
		JOIN recipes r ON r.id = i.recipe_id
		WHERE i.pantry_item_id = ?
		ORDER BY r.title`, pantryItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var titles []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		titles = append(titles, t)
	}
	if titles == nil {
		titles = []string{}
	}
	return titles, rows.Err()
}

func (s *Store) GetUnlinkedIngredients() ([]models.UnlinkedIngredient, error) {
	rows, err := s.db.Query(`
		SELECT i.id, i.recipe_id, r.title, i.name, i.amount, i.unit
		FROM ingredients i
		JOIN recipes r ON r.id = i.recipe_id
		WHERE i.pantry_item_id IS NULL
		ORDER BY r.title, i.sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ings []models.UnlinkedIngredient
	for rows.Next() {
		var ing models.UnlinkedIngredient
		if err := rows.Scan(&ing.ID, &ing.RecipeID, &ing.RecipeTitle, &ing.Name, &ing.Amount, &ing.Unit); err != nil {
			return nil, err
		}
		ings = append(ings, ing)
	}
	if ings == nil {
		ings = []models.UnlinkedIngredient{}
	}
	return ings, rows.Err()
}

func (s *Store) LinkIngredientPantry(id, recipeID int64, pantryItemID *int64) error {
	_, err := s.db.Exec(`UPDATE ingredients SET pantry_item_id=? WHERE id=? AND recipe_id=?`,
		pantryItemID, id, recipeID)
	return err
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

// ── Tags ──────────────────────────────────────────────────────────────────────

func (s *Store) GetRecipeTags(recipeID int64) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT t.name FROM tags t
		JOIN recipe_tags rt ON t.id = rt.tag_id
		WHERE rt.recipe_id = ?
		ORDER BY t.name`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tags = append(tags, name)
	}
	return tags, rows.Err()
}

func (s *Store) ListAllTags() ([]string, error) {
	rows, err := s.db.Query(`SELECT name FROM tags ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tags = append(tags, name)
	}
	return tags, rows.Err()
}

func (s *Store) AddRecipeTag(recipeID int64, tagName string) error {
	tagName = strings.ToLower(strings.TrimSpace(tagName))
	if tagName == "" {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var tagID int64
	err = tx.QueryRow(`SELECT id FROM tags WHERE name = ?`, tagName).Scan(&tagID)
	if err == sql.ErrNoRows {
		res, err := tx.Exec(`INSERT INTO tags (name) VALUES (?)`, tagName)
		if err != nil {
			return err
		}
		tagID, _ = res.LastInsertId()
	} else if err != nil {
		return err
	}

	_, err = tx.Exec(`INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)`, recipeID, tagID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) RemoveRecipeTag(recipeID int64, tagName string) error {
	tagName = strings.ToLower(strings.TrimSpace(tagName))
	_, err := s.db.Exec(`
		DELETE FROM recipe_tags
		WHERE recipe_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)`,
		recipeID, tagName)
	return err
}

// ── Settings ──────────────────────────────────────────────────────────────────

func (s *Store) GetSettings() (models.Settings, error) {
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return models.Settings{}, err
	}
	defer rows.Close()

	settings := models.Settings{AIProvider: "anthropic"}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return settings, err
		}
		switch k {
		case "ai_provider":
			settings.AIProvider = v
		case "anthropic_api_key":
			settings.AnthropicAPIKey = v
		case "gemini_api_key":
			settings.GeminiAPIKey = v
		case "model":
			settings.Model = v
		}
	}
	return settings, nil
}

func (s *Store) UpdateSettings(settings models.Settings) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	upsert := `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	if _, err := tx.Exec(upsert, "ai_provider", settings.AIProvider); err != nil {
		return err
	}
	if _, err := tx.Exec(upsert, "anthropic_api_key", settings.AnthropicAPIKey); err != nil {
		return err
	}
	if _, err := tx.Exec(upsert, "gemini_api_key", settings.GeminiAPIKey); err != nil {
		return err
	}
	if _, err := tx.Exec(upsert, "model", settings.Model); err != nil {
		return err
	}
	return tx.Commit()
}

// buildPlaceholders returns "(?,?,?)" for n items
func buildPlaceholders(n int) string {
	ph := make([]string, n)
	for i := range ph {
		ph[i] = "?"
	}
	return "(" + strings.Join(ph, ",") + ")"
}
