import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import { Bot, Send, User, Sparkles, Lightbulb } from 'lucide-react'

const promptSuggestions = [
  'What can I cook with milk and strawberries expiring today?',
  'How do I store ripe avocados to keep them fresh?',
  'Check my fridge and pantry temperature status',
  'What should I add to my shopping list this week?',
]

export function AssistantPage() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "Hello Sarah! I'm **SaveBite AI**, your pantry and grocery intelligence assistant. I monitor your inventory freshness, IoT storage conditions, and expiry dates to help you eliminate food waste. What can I help you make or store today?",
    },
  ])
  const [inputPrompt, setInputPrompt] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = async (textToSend) => {
    const text = textToSend || inputPrompt
    if (!text.trim() || isTyping) return

    const userMsg = {
      id: 'user_' + Date.now(),
      sender: 'user',
      text: text.trim(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputPrompt('')
    setIsTyping(true)

    try {
      const { data } = await api.assistant.sendMessage(text)
      if (data) {
        setMessages((prev) => [...prev, data])
      }
    } catch (err) {
      console.error('Failed to query assistant:', err)
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          sender: 'assistant',
          text: 'Sorry, I encountered an issue checking your pantry intelligence. Please try again.',
        },
      ])
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 flex flex-col h-[calc(100vh-140px)]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-800 text-white flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight">
              SaveBite AI Copilot
            </h2>
            <p className="text-[11px] text-slate-500">
              Context-aware food-waste prevention & recipe generator
            </p>
          </div>
        </div>
      </div>

      {/* Chat Messages Card */}
      <Card padding="p-4" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {messages.map((m) => {
            const isMe = m.sender === 'user'
            return (
              <div
                key={m.id}
                className={`flex gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs ${
                    isMe
                      ? 'bg-emerald-800 text-white'
                      : 'bg-emerald-100 text-emerald-800 font-bold'
                  }`}
                >
                  {isMe ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                    isMe
                      ? 'bg-emerald-800 text-white rounded-tr-xs'
                      : 'bg-slate-100/80 text-slate-800 rounded-tl-xs'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            )
          })}

          {isTyping && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-slate-100 rounded-2xl px-4 py-3 rounded-tl-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Prompts Pill Row */}
        <div className="pt-3 pb-1 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" /> Prompts:
          </span>
          {promptSuggestions.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(prompt)}
              className="text-[11px] whitespace-nowrap bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100 px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer shrink-0"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Text Input Row */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="pt-2 flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder="Ask anything about recipe ideas, spoilage prevention, or storage..."
            className="flex-1 bg-[#fcfbf9] rounded-xl border border-slate-200 px-4 py-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            icon={Send}
            disabled={!inputPrompt.trim() || isTyping}
          >
            Send
          </Button>
        </form>
      </Card>
    </div>
  )
}

export default AssistantPage
