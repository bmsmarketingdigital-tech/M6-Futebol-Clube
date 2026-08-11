"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeName = "light" | "mid" | "dark";

const STORAGE_KEY = "m6_theme";
const THEME_ORDER: ThemeName[] = ["light", "mid", "dark"];

function isThemeName(value: string | null): value is ThemeName {
  return value === "light" || value === "mid" || value === "dark";
}

function getInitialTheme(): ThemeName {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isThemeName(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Tema do sistema: claro, intermediário ou escuro (cores do escudo M6).
 * Persiste em localStorage (chave "m6_theme", seguindo a convenção m6_*
 * já usada em AccessGate.tsx) e aplica via data-theme no <html>, que os
 * tokens em globals.css (:root, :root[data-theme="mid"], :root[data-theme="dark"])
 * consomem automaticamente. O flash de tema errado no primeiro paint é evitado
 * por um script inline em layout.tsx que roda antes do React montar.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((current) => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]);
  }, []);

  return { theme, setTheme, cycleTheme, themes: THEME_ORDER };
}
