export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function generateGradient(): string {
  const colors = [
    "#3fa1f8", "#69c9f9", "#5ccff8", "#c084fc", "#eef9ff",
  ];
  const shuffled = colors.sort(() => Math.random() - 0.5);
  return `linear-gradient(135deg, ${shuffled[0]}, ${shuffled[1]})`;
}
