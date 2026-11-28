const mongoose = require("mongoose");

const recipeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    ingredients: [
      {
        name: { type: String, required: true },
        quantity: { type: String },
      },
    ],
    instructions: [
      {
        step: { type: Number, required: true },
        description: { type: String, required: true },
      },
    ],
    nutrition: {
      calories: { type: String },
      protein: { type: String },
      carbs: { type: String },
      fat: { type: String },
      fiber: { type: String },
    },
    servings:  { type: String, default: "2" },
    prepTime:  { type: String },
    cookTime:  { type: String },
    dietaryTags: [
      {
        type: String,
        enum: [
          "vegan", "vegetarian", "keto", "gluten-free",
          "dairy-free", "low-carb", "high-protein", "paleo",
        ],
      },
    ],
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },
    imageUrl:            { type: String },
    detectedIngredients: [String],
    prioritizedIngredients: [String], // near-spoiling items the recipe was built around
    excludedIngredients:   [String], // items left out because they looked spoiled
    servingSuggestions:  [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Recipe", recipeSchema);