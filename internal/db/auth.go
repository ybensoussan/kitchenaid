package db

import (
	"database/sql"
	"errors"
	"kitchenaid/internal/models"
	"time"
)

var ErrNotFound = errors.New("not found")

func (s *Store) CreateUser(u models.User) (models.User, error) {
	res, err := s.db.Exec(`
		INSERT INTO users (email, display_name, password_hash, oauth_provider, oauth_id)
		VALUES (?, ?, ?, ?, ?)`,
		u.Email, u.DisplayName, u.PasswordHash, u.OAuthProvider, u.OAuthID)
	if err != nil {
		return models.User{}, err
	}
	u.ID, _ = res.LastInsertId()
	return u, nil
}

func (s *Store) GetUserByEmail(email string) (models.User, error) {
	var u models.User
	err := s.db.QueryRow(`
		SELECT id, email, display_name, password_hash, oauth_provider, oauth_id, created_at
		FROM users WHERE email = ?`, email).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.OAuthProvider, &u.OAuthID, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) GetUserByOAuthID(provider, oauthID string) (models.User, error) {
	var u models.User
	err := s.db.QueryRow(`
		SELECT id, email, display_name, password_hash, oauth_provider, oauth_id, created_at
		FROM users WHERE oauth_provider = ? AND oauth_id = ?`, provider, oauthID).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.OAuthProvider, &u.OAuthID, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) CreateSession(userID int64, token string, expiresAt time.Time) error {
	_, err := s.db.Exec(`
		INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, expiresAt)
	return err
}

func (s *Store) GetSession(token string) (models.Session, error) {
	var sess models.Session
	err := s.db.QueryRow(`
		SELECT s.token, s.user_id, s.expires_at, u.email, u.display_name
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token = ? AND s.expires_at > datetime('now')`, token).Scan(
		&sess.Token, &sess.UserID, &sess.ExpiresAt, &sess.UserEmail, &sess.UserName)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Session{}, ErrNotFound
	}
	return sess, err
}

func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (s *Store) DeleteExpiredSessions() error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at <= datetime('now')`)
	return err
}

func (s *Store) ListUsers() ([]models.User, error) {
	rows, err := s.db.Query(`
		SELECT id, email, display_name, oauth_provider, created_at
		FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.OAuthProvider, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if users == nil {
		users = []models.User{}
	}
	return users, nil
}

func (s *Store) DeleteUser(id int64) error {
	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

func (s *Store) GetUserCount() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}
