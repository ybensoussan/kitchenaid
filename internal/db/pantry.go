package db

import (
	"database/sql"
	"kitchenaid/internal/models"
)

func (s *Store) ListPantryItems() ([]models.PantryItem, error) {
	rows, err := s.db.Query(`SELECT id, name, price, price_unit_size, created_at FROM pantry_items ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.PantryItem
	for rows.Next() {
		var it models.PantryItem
		if err := rows.Scan(&it.ID, &it.Name, &it.Price, &it.PriceUnitSize, &it.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (s *Store) AddPantryItem(inp models.PantryItemInput) (*models.PantryItem, error) {
	res, err := s.db.Exec(`
		INSERT INTO pantry_items (name, price, price_unit_size) VALUES (?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET price=excluded.price, price_unit_size=excluded.price_unit_size`,
		inp.Name, inp.Price, inp.PriceUnitSize)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if id == 0 {
		var it models.PantryItem
		err = s.db.QueryRow(`SELECT id, name, price, price_unit_size, created_at FROM pantry_items WHERE name=?`, inp.Name).
			Scan(&it.ID, &it.Name, &it.Price, &it.PriceUnitSize, &it.CreatedAt)
		if err != nil {
			return nil, err
		}
		return &it, nil
	}
	var it models.PantryItem
	err = s.db.QueryRow(`SELECT id, name, price, price_unit_size, created_at FROM pantry_items WHERE id=?`, id).
		Scan(&it.ID, &it.Name, &it.Price, &it.PriceUnitSize, &it.CreatedAt)
	return &it, err
}

func (s *Store) UpdatePantryItem(id int64, inp models.PantryItemInput) (*models.PantryItem, error) {
	_, err := s.db.Exec(`UPDATE pantry_items SET name=?, price=?, price_unit_size=? WHERE id=?`,
		inp.Name, inp.Price, inp.PriceUnitSize, id)
	if err != nil {
		return nil, err
	}
	var it models.PantryItem
	err = s.db.QueryRow(`SELECT id, name, price, price_unit_size, created_at FROM pantry_items WHERE id=?`, id).
		Scan(&it.ID, &it.Name, &it.Price, &it.PriceUnitSize, &it.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &it, err
}

func (s *Store) DeletePantryItem(id int64) error {
	_, err := s.db.Exec(`DELETE FROM pantry_items WHERE id=?`, id)
	return err
}
