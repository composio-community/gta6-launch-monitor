import { StreamBoard } from "@/components/StreamBoard";

function Palm({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 200 320" aria-hidden="true">
      <path d="M96 320C92 240 104 170 112 96" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <path d="M112 96C80 60 40 58 8 84c36-12 70-4 104 12Z" />
      <path d="M112 96C96 50 60 22 22 22c36 12 66 38 90 74Z" />
      <path d="M112 96c4-48 28-80 64-88-28 22-46 52-64 88Z" />
      <path d="M112 96c30-34 64-40 86-20-30-6-58 4-86 20Z" />
      <path d="M112 96c-28-4-60 10-78 42 26-24 52-34 78-42Z" />
      <path d="M112 96c28-2 54 14 68 48-22-26-44-38-68-48Z" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <div className="sky" aria-hidden="true">
        <div className="sun" />
        <svg className="skyline" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0 120V78h38V52h30v26h26V34h18V14h22v20h16v44h34V60h44v18h22V28h40v50h30V46h26v32h40V66h52V22h14V6h20v16h14v56h36V50h48v28h28V38h34v40h44V58h30v20h40V30h22V12h26v18h18v48h46V62h38v16h30V44h44v34h36V70h50v50Z" />
        </svg>
        <Palm className="palm palm-a" />
        <Palm className="palm palm-b" />
        <Palm className="palm palm-c" />
      </div>

      <div className="shell">
        <header className="masthead">
          <p className="script">Launch day</p>
          <h1 className="wordmark">
            GTA{" "}
            <span className="vi" data-text="VI">
              VI
            </span>
            <span className="wordmark-sub">Launch Monitor</span>
          </h1>
          <p className="lede">
            Who is streaming the game right now, what everyone is saying about it, and how the mood is moving, across
            Twitch, Kick, YouTube, X, Reddit, Instagram and LinkedIn.
          </p>
        </header>

        <StreamBoard />

        <footer className="footer">
          Unofficial fan project, not affiliated with Rockstar Games or Take-Two. Stream data is pulled through Composio
          Instant.
        </footer>
      </div>
    </>
  );
}
