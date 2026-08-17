package db

import (
	"database/sql"
	"strings"

	"kitchenaid/internal/models"
)

// ListGroceryItems returns the standing list: outstanding items first, each
// group in the order it was added.
func (s *Store) ListGroceryItems() ([]models.GroceryListItem, error) {
	rows, err := s.db.Query(`
		SELECT id, name, amount, unit, checked, source, recipe_id, created_at
		FROM grocery_items
		ORDER BY checked ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []models.GroceryListItem{}
	for rows.Next() {
		var it models.GroceryListItem
		var recipeID sql.NullInt64
		if err := rows.Scan(&it.ID, &it.Name, &it.Amount, &it.Unit,
			&it.Checked, &it.Source, &recipeID, &it.CreatedAt); err != nil {
			return nil, err
		}
		if recipeID.Valid {
			id := recipeID.Int64
			it.RecipeID = &id
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// AddGroceryItems appends items, merging into an existing outstanding row when
// the name and unit already match — adding "2 onions" twice gives you 4, not
// two lines. Ticked-off rows are left alone so re-adding starts a fresh entry.
func (s *Store) AddGroceryItems(inputs []models.GroceryListItemInput) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, in := range inputs {
		name := strings.TrimSpace(in.Name)
		if name == "" {
			continue
		}
		unit := strings.TrimSpace(in.Unit)

		var (
			existingID     int64
			existingAmount float64
			existingSource string
		)
		err := tx.QueryRow(`
			SELECT id, amount, source FROM grocery_items
			WHERE checked = 0
			  AND lower(trim(name)) = lower(?)
			  AND lower(trim(unit)) = lower(?)
			LIMIT 1`, name, unit).Scan(&existingID, &existingAmount, &existingSource)

		switch {
		case err == sql.ErrNoRows:
			if _, err := tx.Exec(`
				INSERT INTO grocery_items (name, amount, unit, source, recipe_id)
				VALUES (?, ?, ?, ?, ?)`,
				name, in.Amount, unit, strings.TrimSpace(in.Source), in.RecipeID); err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			// Merge amounts, and keep a combined provenance so the list can
			// show every dish an item is needed for.
			source := mergeSource(existingSource, in.Source)
			if _, err := tx.Exec(`
				UPDATE grocery_items SET amount = ?, source = ? WHERE id = ?`,
				existingAmount+in.Amount, source, existingID); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// mergeSource joins provenance labels without repeating one.
func mergeSource(existing, incoming string) string {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return existing
	}
	if existing == "" {
		return incoming
	}
	for _, part := range strings.Split(existing, ", ") {
		if strings.EqualFold(strings.TrimSpace(part), incoming) {
			return existing
		}
	}
	return existing + ", " + incoming
}

func (s *Store) UpdateGroceryItem(id int64, req models.UpdateGroceryRequest) error {
	sets := []string{}
	args := []any{}
	if req.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, strings.TrimSpace(*req.Name))
	}
	if req.Amount != nil {
		sets = append(sets, "amount = ?")
		args = append(args, *req.Amount)
	}
	if req.Unit != nil {
		sets = append(sets, "unit = ?")
		args = append(args, strings.TrimSpace(*req.Unit))
	}
	if req.Checked != nil {
		sets = append(sets, "checked = ?")
		args = append(args, *req.Checked)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := s.db.Exec(`UPDATE grocery_items SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	return err
}

func (s *Store) DeleteGroceryItem(id int64) error {
	_, err := s.db.Exec(`DELETE FROM grocery_items WHERE id = ?`, id)
	return err
}

// ClearCheckedGroceryItems removes everything already ticked off.
func (s *Store) ClearCheckedGroceryItems() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM grocery_items WHERE checked = 1`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
