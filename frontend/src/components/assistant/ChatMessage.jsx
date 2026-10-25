import React from 'react'
import { User, HelpCircle } from 'lucide-react'
import logoImg from '../../assets/logo.png'

export function ChatMessage({ message, onSelectQuestion }) {
  const isMe = message.sender === 'user'

  return (
    <div className={`flex gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in duration-150`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 text-xs shadow-2xs overflow-hidden ${
          isMe
            ? 'bg-emerald-800 text-white'
            : 'bg-white border border-emerald-100 p-0.5'
        }`}
      >
        {isMe ? (
          <User className="w-4 h-4" />
        ) : (
          <img src={logoImg} alt="SaveBite Help" className="w-full h-full object-contain" />
        )}
      </div>

      {/* Message Bubble & Content */}
      <div className={`max-w-[88%] sm:max-w-[78%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
            isMe
              ? 'bg-emerald-800 text-white rounded-tr-xs shadow-xs'
              : 'bg-white border border-[#edebe4] text-slate-800 rounded-tl-xs shadow-xs'
          }`}
        >
          {/* Render markdown-style bold words cleanly */}
          <div className="whitespace-pre-line">
            {message.text.split('**').map((chunk, idx) =>
              idx % 2 === 1 ? <strong key={idx} className={isMe ? 'text-white' : 'text-emerald-950 font-bold'}>{chunk}</strong> : chunk
            )}
          </div>
        </div>

        {/* Optional suggested questions associated with this answer */}
        {!isMe && message.suggestedQuestions && message.suggestedQuestions.length > 0 && (
          <div className="mt-2.5 space-y-1.5 w-full">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Related Topics:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {message.suggestedQuestions.map((q) => (
                <button
                  key={q.id || q.question}
                  type="button"
                  onClick={() => onSelectQuestion(q)}
                  className="text-left text-[11px] bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 border border-slate-200 hover:border-emerald-300 px-2.5 py-1 rounded-xl transition-all duration-150 cursor-pointer flex items-center gap-1.5"
                >
                  <HelpCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>{q.question}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <span className="text-[10px] text-slate-400 mt-1 px-1">
          {message.timestamp || ''}
        </span>
      </div>
    </div>
  )
}

export default ChatMessage
