import Link from "next/link";
import { games } from "@/lib/games";

const previewTiles = [
  "coral",
  "empty",
  "blue",
  "lime",
  "coral",
  "empty",
  "empty",
  "blue",
  "lime",
] as const;

function PatternPreview() {
  return (
    <div className="pattern-scene" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="pattern-card pattern-card-main">
        <div className="pattern-card-label">
          <span>Turn it</span>
          <span>90°</span>
        </div>
        <div className="pattern-grid">
          {previewTiles.map((tile, index) => (
            <span
              className={`pattern-tile pattern-tile-${tile}`}
              key={`${tile}-${index}`}
            />
          ))}
        </div>
      </div>
      <div className="answer-chip answer-chip-yes">
        <span className="answer-symbol">✓</span>
        Same shape
      </div>
      <div className="answer-chip answer-chip-no">
        <span className="answer-symbol">↔</span>
        Mirror trap
      </div>
    </div>
  );
}

export default function Home() {
  const liveGames = games.filter((game) => game.status === "live");
  const plannedGames = games.filter((game) => game.status === "planned");

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Spatial Gym home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Spatial Gym</span>
        </Link>
        <span className="header-note">Open source · Play free</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Nonverbal reasoning, made playable</p>
          <h1 id="hero-title">
            Train how
            <br />
            you <span className="hero-accent">see.</span>
          </h1>
          <p className="hero-lede">
            Short, focused games for mental rotation, pattern spotting,
            spatial memory, and visual logic. No account. No download.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/games/rotation-match/">
              Play Transformation Match
              <span aria-hidden="true">↗</span>
            </Link>
            <a className="button button-secondary" href="#games">
              Browse the lab
            </a>
          </div>
          <dl className="quick-facts" aria-label="Project highlights">
            <div>
              <dt>{liveGames.length}</dt>
              <dd>game live</dd>
            </div>
            <div>
              <dt>5–12</dt>
              <dd>minute sessions</dd>
            </div>
            <div>
              <dt>3</dt>
              <dd>ways to play</dd>
            </div>
          </dl>
        </div>
        <PatternPreview />
      </section>

      <section className="games-section" id="games" aria-labelledby="games-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The game shelf</p>
            <h2 id="games-title">Pick a mental muscle.</h2>
          </div>
          <p>
            Every game is a self-contained browser experience, designed for
            keyboard, touch, and mouse.
          </p>
        </div>

        <div className="game-grid">
          {liveGames.map((game, index) => (
            <article className="game-card game-card-live" key={game.slug}>
              <div className="game-card-topline">
                <span className="game-number">0{index + 1}</span>
                <span className="status-pill status-live">Live</span>
              </div>
              <div className="game-card-visual game-card-visual-rotation" aria-hidden="true">
                <span className="mini-shape mini-shape-one" />
                <span className="mini-shape mini-shape-two" />
                <span className="turn-arrow">↻</span>
              </div>
              <h3>{game.title}</h3>
              <p>{game.description}</p>
              <ul className="skill-list" aria-label="Skills trained">
                {game.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
              <Link className="game-link" href={`/games/${game.slug}/`}>
                Start a round <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}

          {plannedGames.map((game, index) => (
            <article className="game-card game-card-planned" key={game.slug}>
              <div className="game-card-topline">
                <span className="game-number">0{liveGames.length + index + 1}</span>
                <span className="status-pill">Planned</span>
              </div>
              <div
                className={`game-card-visual game-card-visual-${game.slug}`}
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
                <span />
              </div>
              <h3>{game.title}</h3>
              <p>{game.description}</p>
              <ul className="skill-list" aria-label="Skills trained">
                {game.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
              <span className="game-link game-link-muted">On the roadmap</span>
            </article>
          ))}
        </div>
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <div className="principles-intro">
          <p className="eyebrow">Built for good practice</p>
          <h2 id="principles-title">Small games. Clear feedback. Zero friction.</h2>
        </div>
        <div className="principle-list">
          <article>
            <span>01</span>
            <div>
              <h3>Visual first</h3>
              <p>Minimal reading inside a round, so the reasoning stays nonverbal.</p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h3>Private by default</h3>
              <p>Scores stay on your device. No sign-in and no tracking account.</p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h3>Easy to extend</h3>
              <p>Each game owns one route, its logic, styles, and testable data.</p>
            </div>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <div>
          <span className="footer-mark" aria-hidden="true" />
          <p>
            Spatial Gym is an open-source collection of visual-spatial reasoning
            games.
          </p>
        </div>
        <a href="https://github.com/rfarnham/nonverbal-reasoning-games">
          View the project on GitHub <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </main>
  );
}
