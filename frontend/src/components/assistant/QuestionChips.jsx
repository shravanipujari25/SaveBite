import React from 'react'
import { HelpCircle, ChevronRight } from 'lucide-react'

export function QuestionChips({ questions, onSelectQuestion, title = 'Suggested Questions:' }) {
  if (!questions || questions.length === 0) return null

  return (
    <div className="space-y-1.5 pt-2">
      {title && (
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          {title}
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {questions.map((faq) => (
          <button
            key={faq.id || faq.question}
            type="button"
            onClick={() => onSelectQuestion(faq)}
            className="group inline-flex items-center gap-1.5 text-xs bg-emerald-50/80 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/70 hover:border-emerald-300 px-3 py-1.5 rounded-xl font-medium transition-all duration-150 cursor-pointer text-left"
          >
            <HelpCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{faq.question}</span>
            <ChevronRight className="w-3 h-3 text-emerald-500 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}

export default QuestionChips
