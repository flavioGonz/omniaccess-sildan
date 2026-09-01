"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === "light" ? "dark" : "light";

        // Add smooth transition animation to document
        document.documentElement.classList.add('theme-transition');
        setTheme(newTheme);

        setTimeout(() => {
            document.documentElement.classList.remove('theme-transition');
        }, 500);
    };

    if (!mounted) {
        return (
            <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-card border-border text-foreground"
            >
                <div className="h-[1.2rem] w-[1.2rem]" />
            </Button>
        );
    }

    return (
        <>
            <style jsx global>{`
                .theme-transition,
                .theme-transition *,
                .theme-transition *::before,
                .theme-transition *::after {
                    transition: background-color 0.5s cubic-bezier(0.4, 0, 0.2, 1),
                                border-color 0.5s cubic-bezier(0.4, 0, 0.2, 1),
                                color 0.5s cubic-bezier(0.4, 0, 0.2, 1),
                                fill 0.5s cubic-bezier(0.4, 0, 0.2, 1),
                                stroke 0.5s cubic-bezier(0.4, 0, 0.2, 1) !important;
                }
            `}</style>
            <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-card border-border text-foreground hover:bg-muted dark:bg-muted dark:hover:bg-muted relative overflow-hidden"
                onClick={toggleTheme}
            >
                <AnimatePresence mode="wait" initial={false}>
                    {theme === "dark" ? (
                        <motion.div
                            key="moon"
                            initial={{ rotate: 90, scale: 0, opacity: 0 }}
                            animate={{ rotate: 0, scale: 1, opacity: 1 }}
                            exit={{ rotate: -90, scale: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                            className="absolute inset-0 flex items-center justify-center"
                        >
                            <Moon className="h-[1.2rem] w-[1.2rem] text-blue-400" />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="sun"
                            initial={{ rotate: -90, scale: 0, opacity: 0 }}
                            animate={{ rotate: 0, scale: 1, opacity: 1 }}
                            exit={{ rotate: 90, scale: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                            className="absolute inset-0 flex items-center justify-center"
                        >
                            <Sun className="h-[1.2rem] w-[1.2rem] text-orange-400" />
                        </motion.div>
                    )}
                </AnimatePresence>
                <span className="sr-only">Toggle theme</span>
            </Button>
        </>
    );
}
