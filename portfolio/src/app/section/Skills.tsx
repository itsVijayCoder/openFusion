"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

const SkillParticles = dynamic(() => import("@/components/3d/SkillParticles"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

const skills = [
  { name: "TypeScript", category: "languages", color: "#3178C6", level: 95 },
  { name: "JavaScript", category: "languages", color: "#F7DF1E", level: 92 },
  { name: "Python", category: "languages", color: "#3776AB", level: 85 },
  { name: "Go", category: "languages", color: "#00ADD8", level: 78 },
  { name: "React", category: "frameworks", color: "#61DAFB", level: 96 },
  { name: "Next.js", category: "frameworks", color: "#fff", level: 93 },
  { name: "Node.js", category: "frameworks", color: "#339933", level: 90 },
  { name: "Three.js", category: "frameworks", color: "#fff", level: 82 },
  { name: "PostgreSQL", category: "databases", color: "#336791", level: 88 },
  { name: "Redis", category: "databases", color: "#DC382D", level: 85 },
  { name: "MongoDB", category: "databases", color: "#47A248", level: 80 },
  { name: "AWS", category: "cloud", color: "#FF9900", level: 87 },
  { name: "Docker", category: "cloud", color: "#2496ED", level: 85 },
  { name: "Kubernetes", category: "cloud", color: "#326CE5", level: 75 },
  { name: "Tailwind CSS", category: "frameworks", color: "#06B6D4", level: 94 },
  { name: "GraphQL", category: "frameworks", color: "#E10098", level: 82 },
];

const skillGroups = skills.reduce((acc, skill) => {
  if (!acc[skill.category]) acc[skill.category] = [];
  acc[skill.category].push(skill);
  return acc;
}, {} as Record<string, typeof skills>);

const categoryColors = {
  languages: "#60A5FA",
  frameworks: "#A78BFA",
  databases: "#34D399",
  cloud: "#FBBF24",
};

export function SkillsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="skills" ref={ref} className="relative py-32 overflow-hidden">
      {/* 3D Background */}
      <div className="absolute inset-0 z-0 opacity-40">
        <SkillParticles />
      </div>

      {/* Gradient divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium mb-4">
            Technical Expertise
          </span>
          <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold mb-6">
            Skills & <span className="gradient-text">Technologies</span>
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-2xl mx-auto">
            A deep toolkit built over years of shipping production software across the full stack.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {Object.entries(skillGroups).map(([category, categorySkills], catIndex) => (
            <motion.div
              key={category}
              initial={{ opacity: 0, x: catIndex % 2 === 0 ? -30 : 30 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: catIndex * 0.15 }}
              className="glass-card p-8 glow-border"
            >
              <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: categoryColors[category] }}
                />
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </h3>
              <div className="space-y-4">
                {categorySkills.map((skill) => (
                  <SkillBar key={skill.name} skill={skill} categoryColor={categoryColors[category]} />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SkillBar({
  skill,
  categoryColor,
}: {
  skill: (typeof skills)[0];
  categoryColor: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <div ref={ref} className="group">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-[var(--text-primary)] group-hover:text-blue-400 transition-colors">
          {skill.name}
        </span>
        <span className="text-xs text-[var(--text-muted)] font-mono">{skill.level}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: isInView ? `${skill.level}%` : "0%",
            background: `linear-gradient(90deg, ${skill.color}, ${categoryColor})`,
          }}
        />
      </div>
    </div>
  );
}
