import React, { useState, useEffect, useRef, useMemo } from 'react'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import { ChatMessage } from '../components/assistant/ChatMessage'
import { FAQCategories } from '../components/assistant/FAQCategories'
import { QuestionChips } from '../components/assistant/QuestionChips'
import {
  FAQ_CATEGORIES,
  ASSISTANT_FAQS,
  WELCOME_MESSAGE,
} from '../mocks/assistantFAQs'
import { searchFAQs, matchUserQuery } from '../utils/faqMatcher'
import logoImg from '../assets/logo.png'
import {
  Send,
  Trash2,
  Search,
  Sparkles,
  HelpCircle,
  RefreshCw,
  X,
  BookOpen,
} from 'lucide-react'

export function AssistantPage() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: WELCOME_MESSAGE,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestedQuestions: ASSISTANT_FAQS.slice(0, 4),
    },
  ])
  const [inputQuery, setInputQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const messagesEndRef = useRef(null)

  // Auto-scroll when messages or typing state updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Filtered FAQs for the quick questions browser
  const browsableFAQs = useMemo(() => {
    return searchFAQs(searchFilter, selectedCategory)
  }, [searchFilter, selectedCategory])

  // Handle asking a predefined question
  const handleAskQuestion = (faq) => {
    if (isTyping) return

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg = {
      id: 'user_' + Date.now(),
      sender: 'user',
      text: faq.question,
      timestamp: time,
    }

    setMessages((prev) => [...prev, userMsg])
    setIsTyping(true)

    // Find related questions in same category, excluding the current one
    const related = ASSISTANT_FAQS.filter(
      (f) => f.category === faq.category && f.id !== faq.id
    ).slice(0, 3)

    // Simulate natural brief reading/response delay (350ms)
    setTimeout(() => {
      const assistantMsg = {
        id: 'bot_' + Date.now(),
        sender: 'assistant',
        text: faq.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedQuestions: related,
      }
      setMessages((prev) => [...prev, assistantMsg])
      setIsTyping(false)
    }, 350)
  }

  // Handle typing a free-form question into input
  const handleSubmitInput = (e) => {
    if (e) e.preventDefault()
    const query = inputQuery.trim()
    if (!query || isTyping) return

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg = {
      id: 'user_' + Date.now(),
      sender: 'user',
      text: query,
      timestamp: time,
    }

    setMessages((prev) => [...prev, userMsg])
    setInputQuery('')
    setIsTyping(true)

    // Run local rule-based match
    const matchResult = matchUserQuery(query)

    setTimeout(() => {
      const assistantMsg = {
        id: 'bot_' + Date.now(),
        sender: 'assistant',
        text: matchResult.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedQuestions: matchResult.suggestedQuestions,
      }
      setMessages((prev) => [...prev, assistantMsg])
      setIsTyping(false)
    }, 380)
  }

  // Reset conversation with confirmation
  const handleClearChat = () => {
    setMessages([
      {
        id: 'welcome_' + Date.now(),
        sender: 'assistant',
        text: WELCOME_MESSAGE,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedQuestions: ASSISTANT_FAQS.slice(0, 4),
      },
    ])
    setShowClearConfirm(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-3.5 flex flex-col h-[calc(100vh-125px)] min-h-[550px]">
      {/* 1. Header & Predefined Mode Banner */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-100 p-1 flex items-center justify-center shadow-xs overflow-hidden shrink-0">
            <img src={logoImg} alt="SaveBite Help Assistant" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                SaveBite Help Assistant
              </h1>
              <Badge variant="fresh" size="sm">
                Predefined Responses
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              Instant answers about SaveBite workflows, pantry inventory, smart storage, and recipes.
            </p>
          </div>
        </div>

        {/* Clear Conversation Action */}
        <div className="flex items-center gap-2 shrink-0">
          {showClearConfirm ? (
            <div className="flex items-center gap-1.5 p-1 bg-rose-50 border border-rose-200 rounded-xl text-xs">
              <span className="text-rose-900 font-semibold px-2">Clear chat?</span>
              <button
                type="button"
                onClick={handleClearChat}
                className="px-2.5 py-1 bg-rose-600 text-white rounded-lg font-bold hover:bg-rose-700 transition-colors"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-2 py-1 text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              icon={Trash2}
              onClick={() => setShowClearConfirm(true)}
              disabled={isTyping}
            >
              Clear Chat
            </Button>
          )}
        </div>
      </div>

      {/* 2. Main Chat Container */}
      <Card padding="p-3.5 sm:p-5" className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#faf9f5]/60 border-slate-200">
        {/* Scrollable Conversation History */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 sm:pr-2">
          {messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              onSelectQuestion={handleAskQuestion}
            />
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex gap-3 animate-in fade-in">
              <div className="w-8 h-8 rounded-2xl bg-white border border-emerald-100 p-0.5 flex items-center justify-center shrink-0">
                <img src={logoImg} alt="Typing" className="w-full h-full object-contain" />
              </div>
              <div className="bg-white border border-[#edebe4] rounded-2xl px-4 py-3 rounded-tl-xs flex items-center gap-1.5 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.15s]" />
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 3. Category Selector & Quick FAQ Browser */}
        <div className="shrink-0 pt-3 pb-1 border-t border-slate-200/70 space-y-2">
          {/* FAQ Categories tabs */}
          <FAQCategories
            categories={FAQ_CATEGORIES}
            selectedCategory={selectedCategory}
            onSelectCategory={(catId) => {
              setSelectedCategory(catId)
              setSearchFilter('')
            }}
          />

          {/* Quick Questions Chips Carousel for the selected category */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" /> Topics:
            </span>
            {browsableFAQs.slice(0, 6).map((faq) => (
              <button
                key={faq.id}
                type="button"
                onClick={() => handleAskQuestion(faq)}
                disabled={isTyping}
                className="text-[11px] whitespace-nowrap bg-white text-slate-700 hover:text-emerald-950 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/70 px-2.5 py-1 rounded-full font-medium transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                {faq.question}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Text Query Input & Search */}
        <form
          onSubmit={handleSubmitInput}
          className="shrink-0 pt-2 flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask about recipes, expiry, Use First, smart storage, barcode..."
              disabled={isTyping}
              className="w-full pl-9 pr-4 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all"
            />
            {inputQuery && (
              <button
                type="button"
                onClick={() => setInputQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            icon={Send}
            disabled={!inputQuery.trim() || isTyping}
          >
            Ask
          </Button>
        </form>
      </Card>
    </div>
  )
}

export default AssistantPage
