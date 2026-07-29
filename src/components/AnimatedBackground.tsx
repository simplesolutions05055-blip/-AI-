const particleCount = 32;
const streakCount = 8;

export default function AnimatedBackground() {
  return (
    <div className="animated-background" aria-hidden="true">
      <div className="animated-background__grid" />
      <div className="animated-background__orb animated-background__orb--blue" />
      <div className="animated-background__orb animated-background__orb--green" />
      <div className="animated-background__orb animated-background__orb--purple" />
      <div className="animated-background__orb animated-background__orb--teal" />
      <div className="animated-background__particles">
        {Array.from({ length: particleCount }, (_, index) => (
          <span
            key={`particle-${index}`}
            className="animated-background__particle"
            style={{
              left: `${((index * 37) % 97) + 1}%`,
              width: `${2 + (index % 5)}px`,
              height: `${2 + (index % 5)}px`,
              animationDuration: `${16 + (index % 15)}s`,
              animationDelay: `${index * -0.9}s`,
              transform: `translateX(${(index % 9) * 8 - 32}px)`,
            }}
          />
        ))}
      </div>
      <div className="animated-background__streaks">
        {Array.from({ length: streakCount }, (_, index) => (
          <span
            key={`streak-${index}`}
            className="animated-background__streak"
            style={{
              top: `${10 + index * 10}%`,
              width: `${140 + (index % 4) * 55}px`,
              animationDuration: `${2.2 + (index % 4) * 0.35}s`,
              animationDelay: `${index * -0.8}s`,
            }}
          />
        ))}
      </div>
      <div className="animated-background__pulse-ring animated-background__pulse-ring--one" />
      <div className="animated-background__pulse-ring animated-background__pulse-ring--two" />
    </div>
  );
}
