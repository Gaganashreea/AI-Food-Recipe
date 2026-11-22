const { groq } = require("../config/gemini");
const Recipe = require("../models/Recipe");
const {
  normalizeFreshness,
  partitionIngredients,
  buildFreshnessPromptSection,
  todayISO,
} = require("../utils/freshness");

// ── POST /api/recipes/analyze ────────────────────────────────
const analyzeImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const response = await groq.chat.completions.create({
      model: "qwen/qwen3.8-27b",
      temperature: 0.2,
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
You are the food-freshness inspector of a smart refrigerator app.

Analyze this food image carefully.
Identify ALL visible ingredients, food items, or dishes.

For every identifiable food item, judge freshness from visible cues only:
- Produce: browning, dark/soft spots, wilting, wrinkling, bruising, sprouting, mold
- Meat / fish: grey or green discoloration, slimy or sticky surface, dryness
- Dairy / bread / prepared food: mold, discoloration, separation, pooled liquid
- Packaged food: bulging or damaged packaging, only if clearly visible

Today's date is ${todayISO()}.

ALSO READ PRINTED DATES:
If a package label clearly shows an expiry / use-by / best-before date for an item, read it.
- Only read a date that is clearly printed and legible. NEVER guess or calculate one.
- Ignore manufacturing / packaging / MFG / packed-on dates.
- "expiryDateText": the text exactly as printed, e.g. "EXP 25 NOV 2026".
- "expiryDate": that same date as YYYY-MM-DD. If the numeric format is ambiguous, assume DD/MM/YYYY.
  If only a month and year are printed, use the last day of that month.
- "dateType": "use-by", "best-before", "expiry" or "unknown".
- If there is no legible date for an item, set all three to null.

Freshness scale:
- Fresh: looks like it was just bought, no defects
- Good: minor, normal ageing, fine for several more days
- Fair: visible ageing, should be used soon
- Poor: visible spoilage (mold, slime, rot, strong discoloration) - should be discarded
- Cannot determine visually: sealed/opaque packaging or too far/blurry to judge

IMPORTANT:
- Identify ingredients dynamically from the image.
- Do NOT invent ingredients that are not visible.
- Do NOT provide an exact expiry date unless it is printed on the package.
- Give a reasonable remaining shelf-life range assuming it is kept refrigerated.
- Never mark an item "Fresh" or "Good" if you cannot actually see its condition.
- If this is a prepared dish, identify the dish and its visible ingredients.
- Keep "condition" under 15 words.

Return ONLY valid JSON.
Do not include markdown.

Use exactly this structure:

{
  "ingredients": ["ingredient 1", "ingredient 2"],
  "freshnessAnalysis": [
    {
      "name": "ingredient name (same text as in ingredients)",
      "condition": "short description of what you see",
      "freshness": "Fresh/Good/Fair/Poor/Cannot determine visually",
      "estimatedShelfLife": "e.g. 2-3 days",
      "estimatedDaysMin": 2,
      "estimatedDaysMax": 3,
      "wasteRisk": "Low/Medium/High",
      "useFirst": true,
      "expiryDateText": "EXP 25 NOV 2026 or null",
      "expiryDate": "2026-11-25 or null",
      "dateType": "use-by/best-before/expiry/unknown or null"
    }
  ]
}

Use null for estimatedDaysMin / estimatedDaysMax when freshness is "Cannot determine visually".
Use 0 for both when freshness is "Poor".
Set useFirst to true for Fair items, Poor items, or anything with 2 days or less left.
`,
            },
          ],
        },
      ],
      max_tokens: 3000,
    });

    const text = response.choices[0].message.content || "";

    console.log("Image analysis AI response:", text);

    const cleanedText = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
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

    const { ingredients, items, summary } = normalizeFreshness(
      Array.isArray(analysis.ingredients) ? analysis.ingredients : [],
      analysis.freshnessAnalysis
    );

    res.json({
      ingredients,
      freshnessAnalysis: items,
      freshnessSummary: summary,
      rawResponse: text,
    });
  } catch (error) {
    console.error("Image analysis error:", error);

    res.status(500).json({
      error: "Failed to analyze image",
    });
  }
};
// ── POST /api/recipes/freshness ──────────────────────────────
// Re-evaluates freshness after the user edits/clears a printed date.
const recomputeFreshness = async (req, res) => {
  try {
    const { freshnessAnalysis } = req.body;

    if (!Array.isArray(freshnessAnalysis)) {
      return res.status(400).json({ error: "freshnessAnalysis must be an array" });
    }

    const { items, summary } = normalizeFreshness(
      freshnessAnalysis.map((i) => i && i.name).filter(Boolean),
      freshnessAnalysis
    );

    res.json({ freshnessAnalysis: items, freshnessSummary: summary });
  } catch (error) {
    console.error("Recompute freshness error:", error);
    res.status(500).json({ error: "Failed to update freshness" });
  }
};
// ── POST /api/recipes/generate ───────────────────────────────
const generateRecipe = async (req, res) => {
  try {
    const {
      ingredients,
      dietaryPreference,
      freshness,
      prioritizeFresh = true,
    } = req.body;

    if (!ingredients || ingredients.length === 0) {
      return res.status(400).json({
        error: "Ingredients are required",
      });
    }

    // Freshness-aware: cook with what is safe, prioritise what spoils soonest
    const partition = partitionIngredients(ingredients, freshness);
    const { usable, excluded } = partition;
    // Spoiled items are ALWAYS excluded; prioritising is optional.
    const prioritized = prioritizeFresh === false ? [] : partition.prioritized;

    if (usable.length === 0) {
      return res.status(400).json({
        error:
          "All detected items appear spoiled, so no recipe was generated. Please check them and discard anything unsafe.",
      });
    }

    const usableNames = usable.map((i) => i.name);
    const freshnessSection = buildFreshnessPromptSection(prioritized, excluded);

    // STEP A: Build dietary filter
    const dietFilter = dietaryPreference
      ? `The recipe MUST be ${dietaryPreference}-friendly.`
      : "";

    // STEP B: Construct recipe prompt
    const prompt = `
You are a professional chef and nutritionist.

Based on these ingredients:
${usableNames.join(", ")}

${dietFilter}

${freshnessSection}

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

    // STEP F: Attach original detected ingredients + freshness decisions
    recipe.detectedIngredients = ingredients;
    recipe.prioritizedIngredients = prioritized.map((i) => i.name);
    recipe.excludedIngredients = excluded.map((i) => i.name);

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
    const {
      ingredients,
      dietaryPreference,
      freshness,
      prioritizeFresh = true,
    } = req.body;

    if (!ingredients || ingredients.length === 0) {
      return res.status(400).json({
        error: "Ingredients are required",
      });
    }

    const partition = partitionIngredients(ingredients, freshness);
    const { usable, excluded } = partition;
    const prioritized = prioritizeFresh === false ? [] : partition.prioritized;

    if (usable.length === 0) {
      return res.status(400).json({
        error:
          "All detected items appear spoiled, so no suggestions were generated. Please check them and discard anything unsafe.",
      });
    }

    const usableNames = usable.map((i) => i.name);
    const freshnessSection = buildFreshnessPromptSection(prioritized, excluded);

    const dietFilter = dietaryPreference
      ? `All recipes MUST be ${dietaryPreference}-friendly.`
      : "";

    const prompt = `
You are a professional chef.

Based on these ingredients:
${usableNames.join(", ")}

${dietFilter}

${freshnessSection}

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
  recomputeFreshness,
  generateRecipe,
  generateMultipleRecipes,
  saveRecipe,
  getSavedRecipes,
  getRecipeById,
  deleteRecipe,
};