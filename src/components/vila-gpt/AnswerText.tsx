"use client";

import { parseAnswer } from "@/lib/vila-gpt/client";

/** Resposta do VILA GPT formatada: passos numerados, marcadores, parágrafos. */
export function AnswerText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseAnswer(text);
  return (
    <div className={`space-y-2 text-[15px] leading-relaxed text-slate-100 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === "ol") {
          return (
            <ol key={i} className="space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
                    {j + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{item}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="space-y-1">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-slate-500">•</span>
                  <span className="min-w-0 flex-1">{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}
