import { ASSISTANT_FAQS, FALLBACK_MESSAGE } from '../mocks/assistantFAQs'

/**
 * Tokenize and normalize text for simple keyword matching
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

/**
 * Search the local FAQ database for queries
 *
 * @param {string} query
 * @param {string} [categoryId='all']
 * @returns {Array<object>}
 */
export function searchFAQs(query, categoryId = 'all') {
  let list = ASSISTANT_FAQS
  if (categoryId && categoryId !== 'all') {
    list = list.filter((faq) => faq.category === categoryId)
  }

  if (!query || !query.trim()) {
    return list
  }

  const q = query.trim().toLowerCase()
  const qTokens = tokenize(q)

  const scored = list.map((faq) => {
    let score = 0
    const qLower = faq.question.toLowerCase()
    const aLower = faq.answer.toLowerCase()

    // Exact question match
    if (qLower === q) score += 50
    if (qLower.includes(q)) score += 25

    // Keywords exact / contains match
    for (const kw of faq.keywords || []) {
      const kwLower = kw.toLowerCase()
      if (kwLower === q) score += 40
      if (q.includes(kwLower) || kwLower.includes(q)) score += 20
    }

    // Token overlap
    for (const token of qTokens) {
      if (qLower.includes(token)) score += 5
      if (aLower.includes(token)) score += 2
      for (const kw of faq.keywords || []) {
        if (kw.toLowerCase().includes(token)) score += 6
      }
    }

    return { ...faq, score }
  })

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Find matching FAQ answer for user input
 * Returns { answer, matchedFAQ, suggestedQuestions }
 *
 * @param {string} userInput
 * @returns {{ answer: string, matchedFAQ: object|null, suggestedQuestions: Array<object> }}
 */
export function matchUserQuery(userInput) {
  const matches = searchFAQs(userInput)

  if (matches.length === 0) {
    // Top 3 popular suggestion questions for fallback
    const suggested = ASSISTANT_FAQS.slice(0, 3)
    return {
      answer: FALLBACK_MESSAGE,
      matchedFAQ: null,
      suggestedQuestions: suggested,
    }
  }

  const topMatch = matches[0]

  // If top match is clearly relevant (score >= 10)
  if (topMatch.score >= 10) {
    const related = matches.slice(1, 4)
    return {
      answer: topMatch.answer,
      matchedFAQ: topMatch,
      suggestedQuestions: related,
    }
  }

  // If score is ambiguous or multiple lower-confidence matches
  return {
    answer:
      "I found a few topics that might match your question. Please select the most relevant question below:",
    matchedFAQ: null,
    suggestedQuestions: matches.slice(0, 4),
  }
}
