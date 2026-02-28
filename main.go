package main

import (
	"log"
	"net/http"
	"os"

	"kitchenaid/internal/config"
	"kitchenaid/internal/db"
	"kitchenaid/internal/handlers"
)

func main() {
	cfg := config.Load()

	store, err := db.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}

	if err := os.MkdirAll(cfg.UploadsDir, 0755); err != nil {
		log.Fatalf("uploads dir: %v", err)
	}

	h := &handlers.Handler{
		Store:      store,
		UploadsDir: cfg.UploadsDir,
		DBPath:     cfg.DBPath,
	}

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /api/recipes", h.ListRecipes)
	mux.HandleFunc("POST /api/recipes", h.CreateRecipe)
	mux.HandleFunc("GET /api/recipes/{id}", h.GetRecipe)
	mux.HandleFunc("PUT /api/recipes/{id}", h.UpdateRecipe)
	mux.HandleFunc("PATCH /api/recipes/{id}", h.PatchRecipe)
	mux.HandleFunc("DELETE /api/recipes/{id}", h.DeleteRecipe)

	mux.HandleFunc("POST /api/recipes/{id}/ingredients", h.AddIngredient)
	mux.HandleFunc("PUT /api/recipes/{id}/ingredients/{iid}", h.UpdateIngredient)
	mux.HandleFunc("DELETE /api/recipes/{id}/ingredients/{iid}", h.DeleteIngredient)
	mux.HandleFunc("PUT /api/recipes/{id}/ingredients/reorder", h.ReorderIngredients)

	mux.HandleFunc("POST /api/recipes/{id}/steps", h.AddStep)
	mux.HandleFunc("PUT /api/recipes/{id}/steps/{sid}", h.UpdateStep)
	mux.HandleFunc("DELETE /api/recipes/{id}/steps/{sid}", h.DeleteStep)

	mux.HandleFunc("POST /api/upload", h.Upload)
	mux.HandleFunc("POST /api/import/url", h.ImportURL)
	mux.HandleFunc("POST /api/import/html", h.ImportHTML)

	mux.HandleFunc("GET /api/images/search",  h.SearchImages)
	mux.HandleFunc("POST /api/alternatives", h.FindAlternatives)

	mux.HandleFunc("GET /api/tags",               h.ListAllTags)
	mux.HandleFunc("POST /api/recipes/{id}/tags", h.AddRecipeTag)
	mux.HandleFunc("DELETE /api/recipes/{id}/tags/{name}", h.RemoveRecipeTag)
	mux.HandleFunc("POST /api/recipes/{id}/tags/suggest", h.SuggestTags)

	mux.HandleFunc("GET /api/models",        h.GetModels)

	mux.HandleFunc("GET /api/settings",      h.GetSettings)
	mux.HandleFunc("PUT /api/settings",      h.UpdateSettings)

	mux.HandleFunc("GET /api/db/export",     h.ExportDB)
	mux.HandleFunc("POST /api/db/import",    h.ImportDB)

	mux.HandleFunc("GET /api/pantry",          h.ListPantryItems)
	mux.HandleFunc("POST /api/pantry",         h.CreatePantryItem)
	mux.HandleFunc("POST /api/pantry/batch",   h.BatchAddPantryItems)
	mux.HandleFunc("PUT /api/pantry/{id}",    h.UpdatePantryItem)
	mux.HandleFunc("DELETE /api/pantry/{id}", h.DeletePantryItem)

	// Static files
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadsDir))))
	mux.Handle("/", http.FileServer(http.Dir("./static")))

	log.Printf("KitchenAid listening on http://localhost:%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatal(err)
	}
}
