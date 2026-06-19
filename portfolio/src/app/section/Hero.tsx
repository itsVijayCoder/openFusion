"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Github, Linkedin, Twitter, Mail } from "lucide-react";

const HeroCanvas = dynamic(() => import("@/components/3d/HeroCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

const socialLinks = [
  { icon: Github, href: "https://github.com", label: "GitHub" },
  { icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
  { icon: Twitter, href: "https://twitter.com", label: "Twitter" },
  { icon: Mail, href: "mailto:hello@example.com", label: "Email" },
];

export function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <section
      ref={heroRef}
      className="relative min-h-screen w-full overflow-hidden flex items-center justify-center"
    >
      {/* 3D Background Canvas */}
      <div className="absolute inset-0 z-0">
        <HeroCanvas />
      </div>

      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 z-[1] bg-gradient-to-b from-transparent via-transparent to-[var(--bg-primary)]" />

      {/* Hero Content */}
      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <div
            className="inline-block px-4 py-2 rounded-full glass-card text-sm font-medium mb-8 
            border-blue-500/20 animate-fade-in"
          >
            <span className="text-blue-400">Full-Stack Developer</span> &middot; Building the future{" "}
            <span className="text-purple-400">&middot;</span> of the web
          </div>
        </div>

        <h1
          className="font-heading text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-bold mb-6 
          animate-slide-up leading-none"
          style={{ animationDelay: "0.2s" }}
        >
          <span className="block text-[var(--text-primary)]">John</span>
          <span className="block gradient-text">Doe</span>
        </h1>

        <p
          className="text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 
          leading-relaxed animate-slide-up"
          style={{ animationDelay: "0.4s" }}
        >
          I craft high-performance web applications with cutting-edge technologies.
          Specializing in React ecosystems, distributed systems, and interactive 3D experiences.
        </p>

        <div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 
          animate-slide-up"
          style={{ animationDelay: "0.6s" }}
        >
          <Button size="lg" className="group">
            View Projects{" "}
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </Button>
          <Button size="lg" variant="outline">
            Download Resume
          </Button>
        </div>

        {/* Social Links */}
        <div
          className="flex items-center justify-center gap-4 animate-slide-up"
          style={{ animationDelay: "0.8s" }}
        >
          {socialLinks.map(({ icon: Icon, href, label }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "p-3 rounded-lg glass-card transition-all duration-300 group",
                "hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10"
              )}
              aria-label={label}
            >
              <Icon className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-blue-400 transition-colors" />
            </a>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 animate-float">
        <div className="w-6 h-10 rounded-full border-2 border-[var(--text-muted)]/30 flex justify-center pt-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" />
        </div>
      </div>
    </section>
  );
}
