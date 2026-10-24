// Tooltip.jsx – simple tooltip component using CSS
import React from 'react';

export default function Tooltip({ text, children }) {
  return (
    <div className="relative inline-flex items-center group">
      {children}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 rounded-md bg-slate-800 px-3 py-2 text-xs text-white shadow-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-events-none">
        {text}
      </div>
    </div>
  );
}
