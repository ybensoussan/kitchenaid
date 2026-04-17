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
	mux.HandleFunc("PUT /api/recipes/reorder", h.ReorderRecipes)
	mux.HandleFunc("GET /api/recipes/{id}", h.GetRecipe)
	mux.HandleFunc("PUT /api/recipes/{id}", h.UpdateRecipe)
	mux.HandleFunc("PATCH /api/recipes/{id}", h.PatchRecipe)
	mux.HandleFunc("DELETE /api/recipes/{id}", h.DeleteRecipe)

	mux.HandleFunc("POST /api/recipes/{id}/ingredients", h.AddIngredient)
	mux.HandleFunc("PUT /api/recipes/{id}/ingredients/{iid}", h.UpdateIngredient)
	mux.HandleFunc("PATCH /api/recipes/{id}/ingredients/{iid}", h.PatchIngredient)
	mux.HandleFunc("DELETE /api/recipes/{id}/ingredients/{iid}", h.DeleteIngredient)
	mux.HandleFunc("PUT /api/recipes/{id}/ingredients/reorder", h.ReorderIngredients)

	mux.HandleFunc("POST /api/recipes/{id}/steps", h.AddStep)
	mux.HandleFunc("PUT /api/recipes/{id}/steps/{sid}", h.UpdateStep)
	mux.HandleFunc("DELETE /api/recipes/{id}/steps/{sid}", h.DeleteStep)

	mux.HandleFunc("POST /api/upload", h.Upload)
	mux.HandleFunc("POST /api/import/url", h.ImportURL)
	mux.HandleFunc("POST /api/import/html", h.ImportHTML)
	mux.HandleFunc("POST /api/import/text", h.ImportText)
	mux.HandleFunc("POST /api/import/image", h.ImportImage)

	mux.HandleFunc("GET /api/images/search",  h.SearchImages)
	mux.HandleFunc("GET /img",                h.ProxyImage)
	mux.HandleFunc("POST /api/alternatives", h.FindAlternatives)

	mux.HandleFunc("GET /api/tags",               h.ListAllTags)
	mux.HandleFunc("POST /api/recipes/{id}/tags", h.AddRecipeTag)
	mux.HandleFunc("DELETE /api/recipes/{id}/tags/{name}", h.RemoveRecipeTag)
	mux.HandleFunc("POST /api/recipes/{id}/tags/suggest", h.SuggestTags)

	mux.HandleFunc("GET /api/models",        h.GetModels)

	mux.HandleFunc("GET /api/settings",      h.GetSettings)
	mux.HandleFunc("PUT /api/settings",      h.UpdateSettings)

	mux.HandleFunc("GET /api/recipes/{id}/export", h.ExportRecipe)

	mux.HandleFunc("GET /api/db/export",     h.ExportDB)
	mux.HandleFunc("POST /api/db/import",    h.ImportDB)

	mux.HandleFunc("GET /api/pantry",             h.ListPantryItems)
	mux.HandleFunc("POST /api/pantry",            h.CreatePantryItem)
	mux.HandleFunc("POST /api/pantry/batch",      h.BatchAddPantryItems)
	mux.HandleFunc("POST /api/pantry/merge",      h.MergePantryItems)
	mux.HandleFunc("PUT /api/pantry/{id}",        h.UpdatePantryItem)
	mux.HandleFunc("DELETE /api/pantry/{id}",     h.DeletePantryItem)

	mux.HandleFunc("GET /api/ingredients/unlinked", h.GetUnlinkedIngredients)
	mux.HandleFunc("POST /api/ai/smart-match",      h.SmartMatch)

	mux.HandleFunc("GET /api/ah/search", h.SearchAH)

	mux.HandleFunc("GET /api/plans", h.ListMealPlans)
	mux.HandleFunc("POST /api/plans", h.CreateMealPlan)
	mux.HandleFunc("GET /api/plans/{id}", h.GetMealPlan)
	mux.HandleFunc("DELETE /api/plans/{id}", h.DeleteMealPlan)
	mux.HandleFunc("POST /api/plans/{id}/entries", h.AddMealPlanEntry)
	mux.HandleFunc("DELETE /api/plans/{id}/entries/{eid}", h.DeleteMealPlanEntry)
	mux.HandleFunc("GET /api/plans/{id}/grocery", h.GetGroceryList)

	// Static files
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadsDir))))
	mux.Handle("/", http.FileServer(http.Dir("./static")))

	log.Printf("KitchenAid listening on http://localhost:%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatal(err)
	}
}
