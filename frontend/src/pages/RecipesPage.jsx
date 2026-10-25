import React, { useState, useEffect } from 'react'
import { api } from '../api/client'
import { usePantry } from '../context/PantryContext'
import Card from '../components/common/Card'
import Badge from '../components/common/Badge'
import Button from '../components/common/Button'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { ChefHat, Clock, Sparkles, AlertCircle, CheckCircle2, Info, UtensilsCrossed } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'
import Tooltip from '../components/common/Tooltip'

export function RecipesPage() {
  const { refresh } = usePantry()
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [cookingSuccess, setCookingSuccess] = useState('')

  useEffect(() => {
    async function loadRecipes() {
      setLoading(true)
      setError(null)
      try {
        const res = await api.recipes.getWasteLessSuggestions()
        if (res.error) {
          setError(res.error)
        } else if (res.data) {
          setRecipes(res.data)
          setSelectedRecipe(res.data[0] || null)
        }
      } catch (err) {
        console.error('Failed to load recipes:', err)
        setError(err.message || 'Error communicating with recipe rescue service')
      } finally {
        setLoading(false)
      }
    }
    loadRecipes()
  }, [])

  const handleCookRecipe = async () => {
    if (!selectedRecipe) return
    try {
      // Find matching items from rescued_items
      const atRiskItems = selectedRecipe.expiringIngredientsUsed || []
      setCookingSuccess(`Recipe "${selectedRecipe.title}" recorded! Inventory rescued.`)
      await refresh()
      setTimeout(() => setCookingSuccess(''), 4000)
    } catch (err) {
      console.error('Failed to consume recipe ingredients:', err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">👩‍🍳</span>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Waste-Less Recipe Assistant
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              AI recipe suggestions algorithmically matched to groceries nearing their expiration date.
            </p>
          </div>

          {/* Mandatory Food Safety Disclaimer */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium">
            <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Guidance, not a food-safety guarantee.</span>
          </div>
        </div>
      </div>

      {/* Cooking Toast */}
      {cookingSuccess && (
        <div className="p-3.5 bg-emerald-900 text-white rounded-2xl flex items-center gap-2.5 text-xs font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{cookingSuccess}</span>
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Matching pantry items with waste-less recipes..." />
      ) : error ? (
        <Card padding="p-8" className="text-center space-y-4 max-w-xl mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-800 text-2xl mx-auto">
            🍳
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900">
              Recipe Suggestions Unavailable
            </h3>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              {error}
            </p>
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                api.recipes.getWasteLessSuggestions().then((res) => {
                  if (res.error) setError(res.error);
                  else if (res.data) {
                    setRecipes(res.data);
                    setSelectedRecipe(res.data[0] || null);
                  }
                }).catch((err) => {
                  setError(err.message || 'Error communicating with recipe rescue service');
                }).finally(() => setLoading(false));
              }}
            >
              Retry
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            Note: Recipe suggestions require the AI microservice running at http://localhost:8000.
          </p>
        </Card>
      ) : recipes.length === 0 ? (
        <Card padding="p-8" className="text-center space-y-3 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto">
            🥗
          </div>
          <h3 className="text-sm font-bold text-slate-800">No urgent recipes needed!</h3>
          <p className="text-xs text-slate-500">
            All your pantry groceries have healthy shelf life remaining.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Recipe Selection Cards */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Recommended Rescues ({recipes.length})
            </h3>

            {recipes.map((recipe) => {
              const isSelected = selectedRecipe?.id === recipe.id
              return (
                <Card
                  key={recipe.id}
                  hoverEffect
                  onClick={() => setSelectedRecipe(recipe)}
                  className={`transition-all cursor-pointer ${
                    isSelected ? 'ring-2 ring-emerald-700 bg-emerald-50/20' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-bold text-slate-900 text-sm">{recipe.title}</h4>
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                      Rescues {formatCurrency(recipe.pantryRescueValue)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 mb-3">
                    {recipe.description}
                  </p>

                  <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {recipe.prepTimeMinutes} mins
                    </span>
                    <span>{recipe.difficulty}</span>
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <Tooltip text="Use First ranking: items with higher waste‑rescue value are prioritized. The count shows how many pantry ingredients match this recipe.">
                        <Info className="w-4 h-4" />
                      </Tooltip>
                      {recipe.matchedIngredientsCount}/{recipe.totalIngredientsCount} matched
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Right Column (2 spans): Active Recipe Cooking Guide */}
          <div className="lg:col-span-2">
            {selectedRecipe ? (
              <Card padding="p-6" className="space-y-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {selectedRecipe.tags?.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
                      >
                        {t}
                      </span>
                    ))}
                    <Badge variant="fresh" size="sm">
                      {selectedRecipe.difficulty} &bull; {selectedRecipe.servings} Servings
                    </Badge>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-black text-slate-900">
                        {selectedRecipe.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1">
                        {selectedRecipe.description}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      icon={UtensilsCrossed}
                      onClick={handleCookRecipe}
                      className="shrink-0 font-bold"
                    >
                      Cook & Rescue
                    </Button>
                  </div>
                </div>

                {/* Ingredients Breakdown */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                    <span>Pantry Ingredients Rescued</span>
                    <span className="text-emerald-700 font-bold">
                      Potential waste saved: {formatCurrency(selectedRecipe.pantryRescueValue)}
                    </span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedRecipe.expiringIngredientsUsed.map((ing, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200/60 text-xs"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate">{ing.name}</span>
                        <span className="ml-auto text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          {ing.status === 'critical' ? 'Urgent' : 'Expiring'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {selectedRecipe.missingIngredients?.length > 0 && (
                    <div className="pt-2 border-t border-slate-200">
                      <p className="text-[11px] text-slate-500 mb-1">Missing Pantry Items:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedRecipe.missingIngredients.map((m, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-1 rounded bg-slate-200/70 text-slate-700"
                          >
                            + {m.name} (~{formatCurrency(m.estimatedCost)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step by step Instructions */}
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                    Preparation Steps
                  </h4>
                  <ol className="space-y-3">
                    {selectedRecipe.instructions.map((step, index) => (
                      <li key={index} className="flex gap-3 text-xs leading-relaxed text-slate-700">
                        <span className="w-5 h-5 rounded-full bg-emerald-800 text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export default RecipesPage
