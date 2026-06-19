"use client";

import { useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ExternalLink, Github, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TiltCard } from "@/components/3d/TiltCard";

const projects = [
  {
    title: "Fusion Harness",
    description:
      "A cloud-native multi-model AI coding platform with real-time collaboration, model routing, and auditable execution traces.",
    tags: ["Next.js", "TypeScript", "Cloudflare Workers", "RAG"],
    gradient: "from-blue-500 to-cyan-500",
    stars: 1240,
    links: { github: "#", live: "#" },
    featured: true,
  },
  {
    title: "Spectrum Analytics",
    description:
      "Real-time analytics dashboard with interactive 3D data visualizations, custom chart components, and automated alerting pipelines.",
    tags: ["Three.js", "D3.js", "Go", "WebSocket"],
    gradient: "from-purple-500 to-pink-500",
    stars: 890,
    links: { github: "#", live: "#" },
    featured: true,
  },
  {
    title: "EdgeMesh Router",
    description:
      "High-performance distributed routing system with intelligent load balancing and automatic failover for edge computing infrastructure.",
    tags: ["Go", "gRPC", "Kubernetes", "Prometheus"],
    gradient: "from-green-500 to-emerald-500",
    stars: 560,
    links: { github: "#", live: "#" },
  },
  {
    title: "Neural Canvas",
    description:
      "AI-powered design tool that transforms sketches into production-ready UI components using diffusion models and computer vision.",
    tags: ["Python", "PyTorch", "React", "WebGL"],
    gradient: "from-orange-500 to-red-500",
    stars: 2100,
    links: { github: "#", live: "#" },
    featured: true,
  },
  {
    title: "Quantum Auth",
    description:
      "Zero-knowledge proof authentication system with passkey support, multi-device sync, and hardware security key integration.",
    tags: ["Rust", "WebAuthn", "zk-SNARKs", "SQLite"],
    gradient: "from-indigo-500 to-violet-500",
    stars: 780,
    links: { github: "#", live: "#" },
  },
  {
    title: "Pulse Messenger",
    description:
      "End-to-end encrypted messaging platform with E2E encryption, self-destructing messages, and decentralized storage.",
    tags: ["React Native", "Signal Protocol", "Rust", "MongoDB"],
    gradient: "from-teal-500 to-cyan-500",
    stars: 1450,
    links: { github: "#", live: "#" },
  },
];

const filterOptions = ["All", "Featured", "Open Source", "Tools"];

export function ProjectsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [activeFilter, setActiveFilter] = useState("All");

  const filteredProjects =
    activeFilter === "All"
      ? projects
      : activeFilter === "Featured"
        ? projects.filter((p) => p.featured)
        : activeFilter === "Open Source"
          ? projects.filter((p) => p.stars > 500)
          : projects.filter((p) => p.tags.some((t) => ["Go", "Rust"].includes(t)));

  return (
    <section id="projects" ref={ref} className="relative py-32">
      {/* Gradient dividers */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-purple-500/10 text-purple-400 text-sm font-medium mb-4">
            Featured Work
          </span>
          <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold mb-6">
            Selected <span className="gradient-text">Projects</span>
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-2xl mx-auto mb-8">
            A curated selection of projects showcasing expertise in full-stack development,
            cloud architecture, and interactive experiences.
          </p>

          {/* Filter tabs */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {filterOptions.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  activeFilter === filter
                    ? "bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/25"
                    : "text-[var(--text-secondary)] hover:text-blue-400 hover:bg-blue-500/10"
                )}
              >
                {filter}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Project Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredProjects.map((project, index) => (
            <motion.div
              key={project.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <ProjectCard project={project} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectCard({
  project,
}: {
  project: (typeof projects)[0];
}) {
  return (
    <TiltCard className="h-full">
      <div
        className={cn(
          "glass-card glow-border p-6 sm:p-8 h-full flex flex-col transition-all duration-300",
          "hover:shadow-2xl hover:shadow-blue-500/5 group"
        )}
      >
        {/* Top section with gradient border indicator */}
        <div
          className={cn(
            "h-1 rounded-full mb-6 bg-gradient-to-r",
            project.gradient
          )}
        />

        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl sm:text-2xl font-heading font-bold group-hover:text-blue-400 transition-colors">
            {project.title}
          </h3>
          {project.featured && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-amber-500/10 text-amber-400">
              Featured
            </span>
          )}
        </div>

        <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-6 flex-1">
          {project.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          {project.tags.map((tag, i) => (
            <span
              key={i}
              className="px-3 py-1 rounded-full text-xs font-mono bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-color)]"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Bottom section */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[var(--text-muted)] text-sm">
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2L10.5 7H5L9.5 10.5L8 16L12 13L16 16L14.5 10.5L19 7H13.5L12 2Z" />
              </svg>
              {project.stars.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={project.links.github}
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-500/10 transition-all"
              aria-label="GitHub"
            >
              <Github className="w-4 h-4" />
            </a>
            <a
              href={project.links.live}
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-500/10 transition-all"
              aria-label="Live demo"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </TiltCard>
  );
}
