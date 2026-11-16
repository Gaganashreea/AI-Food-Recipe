const { groq } = require("../config/gemini");
const Recipe = require("../models/Recipe");

// ── POST /api/recipes/analyze ────────────────────────────────
const analyzeImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    // STEP A: Convert buffer to Base64 with MIME type
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    // STEP B: Call Groq Vision
    const response = await groq.chat.completions.create({
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: `
Analyze this food image carefully.

Identify ALL visible ingredients, food items, or dishes.

For every identifiable food item, also analyze:
1. Its visible condition
2. Its freshness
3. Its estimated remaining shelf life
4. Its food waste risk
5. Whether it should be used first

IMPORTANT:
- Identify ingredients dynamically from the image.
- Do NOT invent ingredients that are not visible.
- Do NOT provide an exact expiry date.
- Give a reasonable remaining shelf-life range.
- If freshness cannot reasonably be determined visually, say "Cannot determine visually".
- If this is a prepared dish, identify the dish and its visible or reasonably identifiable ingredients.

Return ONLY valid JSON.
Do not include markdown.

Use exactly this structure:

{
  "ingredients": [
    "ingredient 1",
    "ingredient 2"
  ],
  "freshnessAnalysis": [
    {
      "name": "ingredient name",
      "condition": "visible condition",
      "freshness": "Fresh/Good/Fair/Poor/Cannot determine visually",
      "estimatedShelfLife": "estimated remaining time",
      "wasteRisk": "Low/Medium/High",
      "useFirst": true
    }
  ]
}
`,
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const text = response.choices[0].message.content;

    console.log("Image analysis AI response:", text);

    const cleanedText = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let analysis = null;

    try {
      analysis = JSON.parse(cleanedText);
    } catch {
      const objectMatch = cleanedText.match(/\{[\s\S]*\}/);

      if (objectMatch) {
        try {
          analysis = JSON.parse(objectMatch[0]);
        } catch {
          analysis = null;
        }
      }
    }

    if (!analysis) {
      const arrayMatch = cleanedText.match(/\[[\s\S]*\]/);

      if (arrayMatch) {
        try {
          const ingredients = JSON.parse(arrayMatch[0]);

          analysis = {
            ingredients: Array.isArray(ingredients) ? ingredients : [],
            freshnessAnalysis: [],
          };
        } catch {
          analysis = null;
        }
      }
    }

    if (!analysis) {
      return res.status(500).json({
        error: "Failed to parse image analysis",
      });
    }

    const ingredients = Array.isArray(analysis.ingredients)
      ? analysis.ingredients
      : [];

    const freshnessAnalysis = Array.isArray(analysis.freshnessAnalysis)
      ? analysis.freshnessAnalysis
      : [];

    res.json({
      ingredients,
      freshnessAnalysis,
      rawResponse: text,
    });
  } catch (error) {
    console.error("Image analysis error:", error);

    res.status(500).json({
      error: "Failed to analyze image",
    });
  }
};

// ── POST /api/recipes/generate ───────────────────────────────
const generateRecipe = async (req, res) => {
  try {
    const { ingredients, dietaryPreference } = req.body;

    if (!ingredients || ingredients.length === 0) {
      return res.status(400).json({
        error: "Ingredients are required",
      });
    }

    // STEP A: Build dietary filter
    const dietFilter = dietaryPreference
      ? `The recipe MUST be ${dietaryPreference}-friendly.`
      : "";

    // STEP B: Construct recipe prompt
    const prompt = `
You are a professional chef and nutritionist.

Based on these ingredients:
${ingredients.join(", ")}

${dietFilter}

Generate one detailed recipe.

CRITICAL:
Return ONLY valid JSON.
Do NOT use markdown.
Do NOT use code fences.
Do NOT add explanations before or after the JSON.
Make sure every string is properly enclosed in double quotes.
Make sure every array and object is correctly closed.
Do not put unescaped double quotes inside string values.

Use exactly this structure:

{
  "title": "Recipe Name",
  "ingredients": [
    {
      "name": "ingredient name",
      "quantity": "amount needed"
    }
  ],
  "instructions": [
    {
      "step": 1,
      "description": "Step description"
    }
  ],
  "nutrition": {
    "calories": "approximate calories per serving",
    "protein": "protein in grams",
    "carbs": "carbs in grams",
    "fat": "fat in grams",
    "fiber": "fiber in grams"
  },
  "servings": "number of servings",
  "prepTime": "preparation time",
  "cookTime": "cooking time",
  "difficulty": "Easy/Medium/Hard",
  "dietaryTags": [
    "applicable tags from: vegan, vegetarian, keto, gluten-free, dairy-free, low-carb, high-protein, paleo"
  ],
  "servingSuggestions": [
    "suggestion 1",
    "suggestion 2"
  ]
}
`;

    // STEP C: Call Groq Text
    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1500,
    });

    const text = response.choices[0].message.content;

    console.log("Recipe AI response:", text);

    // STEP D: Clean AI response
    let cleanedText = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Remove anything before the first {
    const firstBrace = cleanedText.indexOf("{");

    if (firstBrace !== -1) {
      cleanedText = cleanedText.substring(firstBrace);
    }

    // Remove anything after the last }
    const lastBrace = cleanedText.lastIndexOf("}");

    if (lastBrace !== -1) {
      cleanedText = cleanedText.substring(0, lastBrace + 1);
    }

    let recipe;

    // STEP E: Parse JSON safely
    try {
      recipe = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("Recipe JSON parsing failed:", parseError);
      console.error("Raw recipe response:", text);

      // Try extracting the largest JSON object
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          recipe = JSON.parse(jsonMatch[0]);
        } catch (secondError) {
          console.error(
            "Second recipe JSON parsing attempt failed:",
            secondError
          );

          return res.status(500).json({
            error: "AI returned invalid recipe data. Please try again.",
          });
        }
      } else {
        return res.status(500).json({
          error: "Failed to parse recipe",
        });
      }
    }

    // STEP F: Attach original detected ingredients
    recipe.detectedIngredients = ingredients;

    res.json({
      recipe,
    });
  } catch (error) {
    console.error("Recipe generation error:", error);

    res.status(500).json({
      error: "Failed to generate recipe",
    });
  }
};

// ── POST /api/recipes/suggestions ───────────────────────────
const generateMultipleRecipes = async (req, res) => {
  try {
    const { ingredients, dietaryPreference } = req.body;

    if (!ingredients || ingredients.length === 0) {
      return res.status(400).json({
        error: "Ingredients are required",
      });
    }

    const dietFilter = dietaryPreference
      ? `All recipes MUST be ${dietaryPreference}-friendly.`
      : "";

    const prompt = `
You are a professional chef.

Based on these ingredients:
${ingredients.join(", ")}

${dietFilter}

Suggest 3 different recipes that can be made.

Return ONLY valid JSON array.
Do not use markdown.
Do not use code fences.
Do not add explanations.

[
  {
    "title": "Recipe Name",
    "description": "Brief 1-line description",
    "difficulty": "Easy/Medium/Hard",
    "cookTime": "estimated time",
    "dietaryTags": [
      "applicable tags"
    ]
  }
]
`;

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 800,
    });

    const text = response.choices[0].message.content;

    console.log("Suggestions AI response:", text);

    const cleanedText = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let suggestions;

    try {
      suggestions = JSON.parse(cleanedText);
    } catch {
      const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        return res.status(500).json({
          error: "Failed to parse suggestions",
        });
      }

      try {
        suggestions = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("Suggestions JSON parsing failed:", parseError);

        return res.status(500).json({
          error: "AI returned invalid suggestion data. Please try again.",
        });
      }
    }

    res.json({
      suggestions,
    });
  } catch (error) {
    console.error("Multiple recipe error:", error);

    res.status(500).json({
      error: "Failed to generate suggestions",
    });
  }
};

// ── POST /api/recipes/save ───────────────────────────────────
const saveRecipe = async (req, res) => {
  try {
    const recipe = new Recipe(req.body);
    const saved = await recipe.save();

    res.status(201).json(saved);
  } catch (error) {
    console.error("Save recipe error:", error);

    res.status(500).json({
      error: "Failed to save recipe",
    });
  }
};

// ── GET /api/recipes/saved ───────────────────────────────────
const getSavedRecipes = async (req, res) => {
  try {
    const { diet, difficulty, search } = req.query;

    const filter = {};

    if (diet) filter.dietaryTags = diet;

    if (difficulty) filter.difficulty = difficulty;

    if (search) {
      filter.title = {
        $regex: search,
        $options: "i",
      };
    }

    const recipes = await Recipe.find(filter).sort({
      createdAt: -1,
    });

    res.json(recipes);
  } catch (error) {
    console.error("Get recipes error:", error);

    res.status(500).json({
      error: "Failed to fetch recipes",
    });
  }
};

// ── GET /api/recipes/saved/:id ───────────────────────────────
const getRecipeById = async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);

    if (!recipe) {
      return res.status(404).json({
        error: "Recipe not found",
      });
    }

    res.json(recipe);
  } catch (error) {
    console.error("Get recipe error:", error);

    res.status(500).json({
      error: "Failed to fetch recipe",
    });
  }
};

// ── DELETE /api/recipes/saved/:id ────────────────────────────
const deleteRecipe = async (req, res) => {
  try {
    const recipe = await Recipe.findByIdAndDelete(req.params.id);

    if (!recipe) {
      return res.status(404).json({
        error: "Recipe not found",
      });
    }

    res.json({
      message: "Recipe deleted successfully",
    });
  } catch (error) {
    console.error("Delete recipe error:", error);

    res.status(500).json({
      error: "Failed to delete recipe",
    });
  }
};

module.exports = {
  analyzeImage,
  generateRecipe,
  generateMultipleRecipes,
  saveRecipe,
  getSavedRecipes,
  getRecipeById,
  deleteRecipe,
};