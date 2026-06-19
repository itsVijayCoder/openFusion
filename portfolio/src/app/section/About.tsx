"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Code2, Globe, Sparkles, Zap, Brain, Shield } from "lucide-react";

const features = [
  {
    icon: Code2,
    title: "Full-Stack Mastery",
    description: "End-to-end delivery from database design to pixel-perfect UIs with React, Node.js, and cloud services.",
  },
  {
    icon: Brain,
    title: "AI & ML Integration",
    description: "Building intelligent systems with LLMs, vector embeddings, and real-time ML inference pipelines.",
  },
  {
    icon: Globe,
    title: "Cloud Architecture",
    description: "Designing scalable, resilient systems on AWS, Cloudflare Workers, and Kubernetes clusters.",
  },
  {
    icon: Shield,
    title: "Security First",
    description: "Implementing zero-trust patterns, encryption, and compliance across all layers of the stack.",
  },
  {
    icon: Zap,
    title: "Performance",
    description: "Optimizing for <100ms response times with edge computing, caching strategies, and efficient algorithms.",
  },
  {
    icon: Sparkles,
    title: "Interactive UX",
    description: "Creating immersive web experiences with Three.js, WebGL shaders, and advanced CSS animations.",
  },
];

export function AboutSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="about" ref={ref} className="relative py-32">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-20">
          {/* Left: Bio */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium mb-6">
              About Me
            </span>
            <h2 className="font-heading text-4xl sm:text-5xl font-bold mb-6">
              Building the <span className="gradient-text">future</span>, one commit at a time
            </h2>
            <div className="space-y-4 text-[var(--text-secondary)] leading-relaxed">
              <p>
                I&apos;m a full-stack developer with 7+ years of experience shipping products that serve millions of users.
                My journey started with hacking together bash scripts and evolved into architecting distributed systems that power
                modern web applications.
              </p>
              <p>
                I&apos;m passionate about the intersection of engineering and design — where clean architecture meets delightful user experiences.
                When I&apos;m not writing code, you&apos;ll find me contributing to open-source projects, mentoring junior developers,
                or experimenting with AI/ML.
              </p>
              <p>
                Currently focused on building the next generation of developer tools and AI-integrated workflows.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10">
              <Stat number="7+" label="Years Experience" />
              <Stat number="50+" label="Projects Shipped" />
              <Stat number="15+" label="Open Source" />
              <Stat number="2.5k+" label="GitHub Stars" />
            </div>
          </motion.div>

          {/* Right: Feature Grid */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                className="glass-card p-6 glow-border group hover:border-blue-500/30 transition-all duration-300"
              >
                <feature.icon className="w-8 h-8 text-blue-400 mb-4 group-hover:scale-110 transition-transform" />
                <h3 className="font-bold text-[var(--text-primary)] mb-2">{feature.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
    </section>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <div ref={ref} className="text-center">
      <div className="font-heading text-3xl font-bold gradient-text">
        {isInView ? number : "0"}
      </div>
      <div className="text-xs text-[var(--text-muted)] font-medium mt-1">{label}</div>
    </div>
  );
}
