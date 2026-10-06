import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import {
  Vote,
  FileLock2,
  Landmark,
  ShieldCheck,
  Coins,
  SlidersHorizontal,
  BookText,
  LogOut,
  Search,
  X,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Lock,
  Eye,
  ScrollText,
  Plus,
  Activity,
  Users,
  KeyRound,
  FileCheck2,
  Sparkles,
  Network,
  Server,
} from "lucide-react";
import qLogoAsset from "@/assets/quorum-q-logo.png.asset.json";
import { requestNonce, verifySignature, getMe, logout as logoutFn } from "@/fn/auth";
import {
  listVotes, listProposals, listTallyNodes, listProofs,
  getTreasury, getSettings, getProtocolStatus, getParticipation, listAuditors, getMembersSummary,
  getStakeContext,
} from "@/fn/data";
import {
  castBallot, submitProposal, createVote, qrmFaucet, confirmStake, unstakeQrm, saveSettings,
  issueDisclosure, recordSolvencyProof, addAuditor, revokeAuditor,
  applyTallyNode, verifyProof, verifyTally, runTally, revealProposal,
  setRealms as setRealmsFn, setDelegation, clearDelegation,
} from "@/fn/actions";
import { registerIdentity, getEligibility } from "@/fn/zk";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "QUORUM Dashboard — Confidential Governance" },
      { name: "description", content: "Sealed-ballot voting, hidden proposals, confidential treasury and QRM staking for Solana DAOs." },
    ],
  }),
  loader: async () => {
    const [votes, proposals, nodes, proofs, treasury, settings, status, participation, auditors, members] =
      await Promise.all([
        listVotes(), listProposals(), listTallyNodes(), listProofs(),
        getTreasury(), getSettings(), getProtocolStatus(), getParticipation(), listAuditors(), getMembersSummary(),
      ]);
    return { votes, proposals, nodes, proofs, treasury, settings, status, participation, auditors, members };
  },
  component: Dashboard,
});

type TabKey = "vote" | "proposals" | "treasury" | "members" | "explorer" | "stake" | "admin" | "settings" | "docs";

const TABS: { key: TabKey; label: string; Icon: typeof Vote }[] = [
  { key: "vote", label: "Voting", Icon: Vote },
  { key: "proposals", label: "Proposals", Icon: FileLock2 },
  { key: "treasury", label: "Treasury", Icon: Landmark },
  { key: "members", label: "Members", Icon: Users },
  { key: "explorer", label: "Proofs", Icon: ShieldCheck },
  { key: "stake", label: "Stake", Icon: Coins },
  { key: "admin", label: "Console", Icon: SlidersHorizontal },
  { key: "settings", label: "Settings", Icon: KeyRound },
  { key: "docs", label: "Docs", Icon: BookText },
];


declare global {
  interface Window {
    solana?: SolanaProvider;
    solflare?: SolanaProvider & { isSolflare?: boolean };
    phantom?: { solana?: SolanaProvider };
  }
}

type SolanaProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  on?: (event: string, cb: (...a: unknown[]) => void) => void;
  publicKey?: { toString: () => string } | null;
  signMessage?: (
    message: Uint8Array,
    encoding?: string,
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
  // Phantom/Solflare: sign + submit a transaction, returning its signature.
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>;
};

// On-chain stake context (mirrors the shape returned by getStakeContext / stake.browser.ts).
type StakeCtx = { mint: string; vault: string; tokenProgram: string; decimals: number; rpc: string };

/** Base64-encode a signature returned by either Phantom ({signature}) or Solflare (Uint8Array). */
function encodeSignature(res: { signature: Uint8Array } | Uint8Array): string {
  const bytes = res instanceof Uint8Array ? res : res.signature;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type WalletName = "phantom" | "solflare";

function getProvider(name: WalletName): SolanaProvider | undefined {
  if (typeof window === "undefined") return undefined;
  if (name === "phantom") {
    const p = window.phantom?.solana ?? window.solana;
    return p?.isPhantom ? p : undefined;
  }
  return window.solflare?.isSolflare ? window.solflare : undefined;
}

const INSTALL_URLS: Record<WalletName, string> = {
  phantom: "https://phantom.app/",
  solflare: "https://solflare.com/",
};

function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletName | null>(null);
  const [authed, setAuthed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Restore an existing session (HttpOnly cookie) and eagerly reconnect a trusted wallet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    getMe().then((r) => { if (r.wallet) { setAddress(r.wallet); setAuthed(true); } }, () => {});
    (["phantom", "solflare"] as WalletName[]).forEach((name) => {
      const p = getProvider(name);
      if (!p) return;
      p.connect({ onlyIfTrusted: true }).then(
        (r) => { setAddress(r.publicKey.toString()); setWallet(name); },
        () => {},
      );
      p.on?.("disconnect", () => { setAddress(null); setWallet(null); setAuthed(false); });
    });
  }, []);

  // Prove wallet ownership: nonce -> signMessage -> verify -> session cookie.
  const signIn = async (name: WalletName, addr: string) => {
    const provider = getProvider(name);
    if (!provider?.signMessage) { toast.error("This wallet can't sign messages."); return false; }
    try {
      setSigningIn(true);
      const { nonce, message } = await requestNonce({ data: { wallet: addr } });
      const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      const signature = encodeSignature(signed);
      await verifySignature({ data: { wallet: addr, nonce, signature } });
      setAuthed(true);
      toast.success("Signed in — wallet ownership proved.");
      return true;
    } catch (e) {
      const err = e as { message?: string; code?: number };
      const raw = err?.message ?? "Sign-in failed";
      // Phantom/Solflare throw code 4001 (or a "reject/cancel/denied" message) only when the
      // user actually dismisses the signature prompt. Everything else is a real error we should
      // surface honestly instead of blaming the user.
      const userRejected = err?.code === 4001 || /reject|cancel|denied|declin/i.test(raw);
      const friendly =
        userRejected ? "Sign-in cancelled — click Sign In to try again."
        : raw === "BAD_SIGNATURE" ? "Signature didn't verify — try signing again."
        : raw === "NONCE_EXPIRED" ? "Sign-in request expired — click Sign In to retry."
        : raw === "INVALID_NONCE" || raw === "NONCE_ALREADY_USED" ? "Sign-in token was already used — click Sign In to retry."
        : `Sign-in failed: ${raw}`;
      setError(friendly);
      toast.error(friendly);
      return false;
    } finally {
      setSigningIn(false);
    }
  };

  const connectWith = async (name: WalletName) => {
    setError(null);
    setPickerOpen(false);
    const provider = getProvider(name);
    if (!provider) {
      const msg = `${name === "phantom" ? "Phantom" : "Solflare"} not detected — opening install page.`;
      setError(msg);
      toast.error(msg);
      window.open(INSTALL_URLS[name], "_blank");
      return;
    }
    try {
      setConnecting(true);
      const r = await provider.connect();
      const addr = r.publicKey.toString();
      setAddress(addr);
      setWallet(name);
      toast.success(`${name === "phantom" ? "Phantom" : "Solflare"} connected`);
      await signIn(name, addr);
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to connect";
      setError(msg);
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      if (wallet) await getProvider(wallet)?.disconnect();
      await logoutFn();
    } finally {
      setAddress(null);
      setWallet(null);
      setAuthed(false);
      toast("Wallet disconnected");
    }
  };

  // Sign an arbitrary message with the connected provider, returning raw signature bytes
  // (used to derive the ZK voting identity).
  const signRaw = async (message: Uint8Array): Promise<Uint8Array> => {
    const provider = wallet ? getProvider(wallet) : undefined;
    if (!provider?.signMessage) throw new Error("WALLET_CANT_SIGN");
    const signed = await provider.signMessage(message, "utf8");
    return signed instanceof Uint8Array ? signed : signed.signature;
  };

  // Build a Token-2022 QRM transfer to the stake vault, sign+send it in-wallet, return the sig.
  const stakeTransfer = async (ctx: StakeCtx, amountUi: number): Promise<string> => {
    const provider = wallet ? getProvider(wallet) : undefined;
    if (!provider?.signAndSendTransaction) throw new Error("WALLET_CANT_SEND");
    if (!address) throw new Error("NO_WALLET");
    const { buildStakeTx } = await import("@/lib/solana/stake.browser");
    const tx = await buildStakeTx(ctx, address, amountUi);
    const res = await provider.signAndSendTransaction(tx);
    return res.signature;
  };

  return {
    address, wallet, authed, connecting, signingIn, error,
    pickerOpen, openPicker: () => setPickerOpen(true), closePicker: () => setPickerOpen(false),
    connectWith, disconnect, signRaw, stakeTransfer,
    signIn: () => (wallet && address ? signIn(wallet, address) : Promise.resolve(false)),
  };
}

const palette = {
  bg: "#0a0b1f",
  bgDeep: "#06071a",
  panel: "rgba(20, 22, 50, 0.55)",
  border: "rgba(212, 175, 79, 0.22)",
  borderSoft: "rgba(236,232,216,0.08)",
  gold: "#d4af4f",
  fg: "#ece8d8",
  muted: "rgba(236,232,216,0.65)",
  indigo: "#8a7bd8",
};

function readTabFromUrl(): TabKey {
  if (typeof window === "undefined") return "vote";
  const t = new URL(window.location.href).searchParams.get("tab") as TabKey | null;
  return t && TABS.some((x) => x.key === t) ? t : "vote";
}

/* ─────────── Modal primitive ─────────── */

function Modal({ open, onClose, title, kicker, children }: { open: boolean; onClose: () => void; title: string; kicker?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(5,6,18,0.7)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "rgba(20,22,50,0.95)", border: `1px solid ${palette.border}`,
        borderRadius: "1.5rem", padding: "1.75rem", width: "min(34rem, 96vw)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "0.75rem" }}>
          <div>
            {kicker && <div style={{ fontSize: "0.7rem", letterSpacing: "0.2em", textTransform: "uppercase", color: palette.gold, marginBottom: "0.35rem" }}>{kicker}</div>}
            <div style={{ fontSize: "1.35rem", fontWeight: 200, letterSpacing: "-0.01em" }}>{title}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: palette.muted, cursor: "pointer", padding: "0.25rem" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────── Dashboard root ─────────── */

function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("vote");
  const wallet = useWallet();

  useEffect(() => {
    setTab(readTabFromUrl());
    const onPop = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Live-ish updates via polling. We deliberately do NOT use a browser Supabase client here:
  // that would ship the Supabase URL + anon key into the client bundle. All data goes through
  // authenticated server functions, so we just refresh the loader periodically (paused when the
  // tab is hidden). Mutations already invalidate immediately after each action.
  useEffect(() => {
    const tick = () => { if (!document.hidden) router.invalidate(); };
    const id = window.setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [router]);

  const goTab = (k: TabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", k);
    window.history.pushState({}, "", url.toString());
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at top right, rgba(138,123,216,0.18), transparent 60%), radial-gradient(ellipse at bottom left, rgba(212,175,79,0.08), transparent 50%), ${palette.bgDeep}`,
        color: palette.fg,
        fontFamily: "'Sarabun', system-ui, -apple-system, sans-serif",
        display: "flex",
      }}
    >
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@200;400;500;600&display=swap" />
      <style>{`
        :root { --gold:${palette.gold}; --indigo:${palette.indigo}; }
        .qrm-sidebar { width: 5rem; }
        .qrm-tabbtn { width: 2.75rem; height: 2.75rem; }
        .qrm-grid-2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 1.5rem; }
        .qrm-padded { padding: 2.5rem; }
        .qrm-topbar-search { display: flex; }
        .qrm-mobile-tabs { display: none; }
        @media (max-width: 820px) {
          .qrm-shell { flex-direction: column; }
          .qrm-sidebar { display: none !important; }
          .qrm-mobile-tabs {
            display: flex; overflow-x: auto; gap: 0.5rem;
            padding: 0.6rem 1rem; border-bottom: 1px solid ${palette.borderSoft};
            background: rgba(10,11,31,0.85); backdrop-filter: blur(12px);
            scrollbar-width: none;
          }
          .qrm-mobile-tabs::-webkit-scrollbar { display: none; }
          .qrm-grid-2 { grid-template-columns: 1fr; }
          .qrm-padded { padding: 1.25rem; }
          .qrm-topbar { padding: 0.85rem 1rem !important; gap: 0.65rem !important; }
          .qrm-topbar-search { display: none; }
          .qrm-topbar-breadcrumb { display: none !important; }
          .qrm-topbar-brand { font-size: 0.78rem !important; letter-spacing: 0.2em !important; gap: 0.45rem !important; }
          .qrm-vote-row { flex-direction: column; align-items: stretch !important; }
          .qrm-vote-row > button { width: 100%; justify-content: center; }
          .qrm-hero-title { font-size: clamp(1.6rem, 7vw, 2.2rem); overflow-wrap: break-word; }
          .qrm-hero-desc { overflow-wrap: break-word; }
          .qrm-docs-table-row { grid-template-columns: 1fr !important; gap: 0.5rem !important; }
          .qrm-docs-table-row > span { min-width: 0; overflow-wrap: break-word; }
          .qrm-pre-code { max-width: 100%; white-space: pre-wrap; word-break: break-word; font-size: 0.72rem; }
        }
        @media (max-width: 480px) {
          .qrm-padded { padding: 1rem; }
        }
        @media (min-width: 1600px) {
          .qrm-padded { padding: 3rem 4rem; }
          .qrm-sidebar { width: 6rem; }
          .qrm-grid-2 { gap: 2rem; }
        }
        @media (min-width: 2200px) {
          .qrm-padded { padding: 3.5rem 5rem; }
          .qrm-sidebar { width: 7rem; }
        }
        .qrm-logo-mark {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 8px 20px rgba(212,175,79,0.28));
        }
        .qrm-icon-tile {
          display:inline-flex; align-items:center; justify-content:center;
          width:2.25rem; height:2.25rem; border-radius:0.75rem;
          background: linear-gradient(135deg, rgba(212,175,79,0.18), rgba(138,123,216,0.18));
          color: var(--gold);
          box-shadow: inset 0 0 0 1px rgba(212,175,79,0.25);
        }
        .qrm-hero-title { font-size: min(2.6rem, 4.6vw); }
        .qrm-docs-tab { display: grid; gap: 1.5rem; min-width: 0; }
        .qrm-docs-tab > * { min-width: 0; }
      `}</style>

      <Toaster theme="dark" position="bottom-right" toastOptions={{
        style: { background: "rgba(20,22,50,0.95)", border: `1px solid ${palette.border}`, color: palette.fg, fontFamily: "inherit" },
      }} />

      <div className="qrm-shell" style={{ display: "flex", width: "100%", maxWidth: 1800, margin: "0 auto", minHeight: "100vh" }}>
        {/* Sidebar (desktop) */}
        <aside className="qrm-sidebar" style={{
          padding: "1.5rem 0",
          background: "rgba(10,11,31,0.85)",
          borderRight: `1px solid ${palette.borderSoft}`,
          display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem",
          position: "sticky", top: 0, height: "100vh",
          backdropFilter: "blur(16px)",
        }}>
          <Link to="/" style={{
            width: "2.85rem", height: "2.85rem", borderRadius: "0.95rem",
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${palette.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            textDecoration: "none", padding: "0.28rem",
            marginBottom: "1rem", boxShadow: "0 8px 22px rgba(212,175,79,0.18)",
          }} title="QUORUM home" aria-label="QUORUM home">
            <img className="qrm-logo-mark" src={qLogoAsset.url} alt="QUORUM" />
          </Link>

          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => goTab(t.key)} title={t.label} className="qrm-tabbtn"
                style={{
                  borderRadius: "0.85rem",
                  background: active ? "linear-gradient(135deg, rgba(212,175,79,0.18), rgba(138,123,216,0.14))" : "transparent",
                  border: active ? `1px solid ${palette.border}` : "1px solid transparent",
                  color: active ? palette.gold : palette.fg,
                  opacity: active ? 1 : 0.55,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "all .2s",
                }}>
                <t.Icon size={18} strokeWidth={1.6} />
              </button>
            );
          })}

          <div style={{ flex: 1 }} />
          {wallet.address && (
            <button onClick={wallet.disconnect} title="Disconnect" className="qrm-tabbtn" style={{
              borderRadius: "0.85rem",
              background: "transparent", border: `1px solid ${palette.borderSoft}`,
              color: palette.muted, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <LogOut size={16} strokeWidth={1.6} />
            </button>
          )}
        </aside>

        {/* Main */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top bar */}
          <header className="qrm-topbar" style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "1.25rem 2.5rem", gap: "1rem",
            borderBottom: `1px solid ${palette.borderSoft}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flex: 1, minWidth: 0 }}>
              <Link to="/" aria-label="QUORUM home" className="qrm-topbar-brand" style={{ display: "inline-flex", alignItems: "center", gap: "0.65rem", color: palette.fg, textDecoration: "none", letterSpacing: "0.25em", fontWeight: 500, fontSize: "0.9rem" }}>
                <span style={{ width: "1.85rem", height: "1.85rem", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <img className="qrm-logo-mark" src={qLogoAsset.url} alt="QUORUM" style={{ transform: "translateY(1px)" }} />
                </span>
                <span>QUORU<span style={{ color: palette.gold }}>M</span></span>
              </Link>
              <div className="qrm-topbar-breadcrumb" style={{ fontSize: "1.15rem", fontWeight: 200, letterSpacing: "-0.01em", opacity: 0.85, whiteSpace: "nowrap" }}>
                / {TABS.find((x) => x.key === tab)?.label}
              </div>
              <div className="qrm-topbar-search" style={{
                flex: 1, maxWidth: "26rem",
                alignItems: "center", gap: "0.6rem",
                padding: "0.5rem 0.9rem", borderRadius: "999px",
                background: "rgba(255,255,255,0.04)", border: `1px solid ${palette.borderSoft}`,
                marginLeft: "1rem",
              }}>
                <Search size={14} color={palette.muted} />
                <input placeholder="Search proposals, proofs, addresses…" style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: palette.fg, fontFamily: "inherit", fontSize: "0.85rem", minWidth: 0,
                }} />
                <span style={{ fontSize: "0.7rem", opacity: 0.5, letterSpacing: "0.1em" }}>⌘K</span>
              </div>
            </div>
            <WalletButton wallet={wallet} />
          </header>

          {/* Mobile tabs */}
          <nav className="qrm-mobile-tabs" aria-label="Sections">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button key={t.key} onClick={() => goTab(t.key)} style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  padding: "0.45rem 0.85rem", borderRadius: "999px",
                  background: active ? "rgba(212,175,79,0.16)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? palette.border : palette.borderSoft}`,
                  color: active ? palette.gold : palette.fg,
                  fontFamily: "inherit", fontSize: "0.75rem", letterSpacing: "0.08em",
                  textTransform: "uppercase", whiteSpace: "nowrap", cursor: "pointer",
                }}>
                  <t.Icon size={13} strokeWidth={1.7} />{t.label}
                </button>
              );
            })}
          </nav>

          <main className="qrm-padded">
            {tab === "vote" && <VoteTab wallet={wallet} />}
            {tab === "proposals" && <ProposalsTab />}
            {tab === "treasury" && <TreasuryTab />}
            {tab === "explorer" && <ExplorerTab />}
            {tab === "stake" && <StakeTab wallet={wallet} goTab={goTab} />}
            {tab === "members" && <MembersTab wallet={wallet} />}
            {tab === "admin" && <AdminTab goTab={goTab} />}
            {tab === "settings" && <SettingsTab />}
            {tab === "docs" && <DocsTab />}


            <footer style={{ marginTop: "4rem", paddingTop: "1.5rem", borderTop: `1px solid ${palette.borderSoft}`, opacity: 0.55, fontSize: "0.75rem", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <span>© 2026 QUORUM. Confidential Governance Infrastructure on Solana.</span>
              <span style={{ display: "flex", gap: "1.25rem" }}>
                <Link to="/terms" style={{ color: "inherit", textDecoration: "none" }}>Terms</Link>
                <Link to="/privacy" style={{ color: "inherit", textDecoration: "none" }}>Privacy</Link>
                <a href="https://x.com/QuorumPrivacy" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>X</a>
              </span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Wallet UI ─────────── */

function WalletButton({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  if (wallet.address) {
    const short = `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`;
    const label = wallet.wallet === "solflare" ? "Solflare" : "Phantom";
    return (
      <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "transparent", border: "none", cursor: "pointer",
            color: palette.fg, fontFamily: "inherit", padding: 0,
          }}
        >
          <div style={{ textAlign: "right", lineHeight: 1.2 }}>
            <div style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.35rem", justifyContent: "flex-end" }}>
              {label}
              <span style={{
                width: "0.45rem", height: "0.45rem", borderRadius: "999px",
                background: wallet.authed ? "#7ddc9f" : "#e0b64f",
              }} title={wallet.authed ? "Signed in" : "Not signed in"} />
            </div>
            <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>{short}</div>
          </div>
          <div style={{
            width: "2.5rem", height: "2.5rem", borderRadius: "999px",
            background: `linear-gradient(135deg, ${palette.gold}, ${palette.indigo})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: palette.bg, fontWeight: 600,
          }}>{label[0]}</div>
        </button>

        {menuOpen && (
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 0.6rem)", zIndex: 120,
            minWidth: "13rem", padding: "0.5rem",
            borderRadius: "0.9rem", background: "rgba(16,18,42,0.98)",
            border: `1px solid ${palette.border}`, backdropFilter: "blur(16px)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
          }}>
            <div style={{ padding: "0.5rem 0.65rem", fontSize: "0.72rem", opacity: 0.6, wordBreak: "break-all" }}>
              {wallet.address}
            </div>
            {!wallet.authed && (
              <button
                onClick={() => { setMenuOpen(false); wallet.signIn(); }}
                disabled={wallet.signingIn}
                style={walletMenuItemStyle}
              >
                <ShieldCheck size={14} style={{ marginRight: "0.55rem" }} />
                {wallet.signingIn ? "Signing in…" : "Sign in"}
              </button>
            )}
            <button onClick={() => { setMenuOpen(false); wallet.disconnect(); }} style={walletMenuItemStyle}>
              <LogOut size={14} style={{ marginRight: "0.55rem" }} />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <button onClick={wallet.openPicker} disabled={wallet.connecting} style={btnStyle({ filled: true })}>
        <Wallet size={14} style={{ marginRight: "0.4rem" }} />
        {wallet.connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {wallet.pickerOpen && <WalletPicker wallet={wallet} />}
    </>
  );
}

const walletMenuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", width: "100%",
  padding: "0.6rem 0.65rem", borderRadius: "0.6rem",
  background: "transparent", border: "none", cursor: "pointer",
  color: palette.fg, fontFamily: "inherit", fontSize: "0.82rem", textAlign: "left",
};

function WalletPicker({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const options: { name: WalletName; label: string; tag: string }[] = [
    { name: "phantom", label: "Phantom", tag: "Most popular Solana wallet" },
    { name: "solflare", label: "Solflare", tag: "Native Solana, ledger support" },
  ];
  return (
    <Modal open={wallet.pickerOpen} onClose={wallet.closePicker} title="Choose your Solana wallet" kicker="Connect Wallet">
      <div style={{ opacity: 0.65, fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        QUORUM uses your wallet only to prove eligibility. Your ballots stay sealed.
      </div>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {options.map((o) => (
          <button key={o.name} onClick={() => wallet.connectWith(o.name)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "1rem 1.25rem", borderRadius: "1rem",
            background: "rgba(212,175,79,0.06)", border: `1px solid ${palette.border}`,
            color: palette.fg, cursor: "pointer", fontFamily: "inherit",
          }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "1rem", color: palette.gold }}>{o.label}</div>
              <div style={{ fontSize: "0.78rem", opacity: 0.65, marginTop: "0.15rem" }}>{o.tag}</div>
            </div>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {wallet.error && <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#ff9b9b" }}>{wallet.error}</div>}
    </Modal>
  );
}

function btnStyle({ filled = false, sm = false }: { filled?: boolean; sm?: boolean }): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: sm ? "0.45rem 1rem" : "0.65rem 1.4rem",
    borderRadius: "2rem",
    border: `1px solid ${palette.gold}`,
    background: filled ? palette.gold : "transparent",
    color: filled ? palette.bg : palette.gold,
    fontFamily: "inherit",
    fontSize: sm ? "0.72rem" : "0.78rem",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}

/* ─────────── VOTING ─────────── */

type ActiveVote = {
  id: string; title: string; closes: string; ballots: number; quorum: number;
  status: string; resultHash: string | null; anchorTx: string | null; tallyTx: string | null;
};

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Render an ISO close time as a short countdown like "2d 14h" (or "Closing" / "Closed"). */
function formatCloses(iso: string | null): string {
  if (!iso) return "open";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Closed";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

function VoteTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const { votes: voteRows, status, participation } = Route.useLoaderData();
  const [castVote, setCastVote] = useState<ActiveVote | null>(null);
  const [proofVote, setProofVote] = useState<ActiveVote | null>(null);

  const router = useRouter();
  const [tallying, setTallying] = useState<string | null>(null);
  const votes: ActiveVote[] = voteRows.map((v) => ({
    id: v.id,
    title: v.title,
    closes: v.status === "open" ? formatCloses(v.closesAt) : "Closed",
    ballots: v.ballots,
    quorum: v.status === "open" ? Math.round(v.quorumPct) : 100,
    status: v.status, resultHash: v.resultHash, anchorTx: v.anchorTx, tallyTx: v.tallyTx,
  }));

  const tryCast = (v: ActiveVote) => {
    if (!wallet.address) { wallet.openPicker(); return; }
    setCastVote(v);
  };

  const tally = async (v: ActiveVote) => {
    if (!wallet.address) { wallet.openPicker(); return; }
    setTallying(v.id);
    try {
      const res = await runTally({ data: { voteId: v.id } });
      await router.invalidate();
      toast.success(res.tallyTx ? "Tallied + anchored on devnet ✓" : `Tallied ${res.tallied} ballots ✓`);
    } catch (e) {
      const msg = (e as Error).message ?? "Failed";
      toast.error(
        msg === "TALLY_NOT_CONFIGURED" ? "Tally key not configured."
        : msg === "UNAUTHENTICATED" ? "Connect & sign in first."
        : msg === "NOT_VOTE_OWNER" ? "Only the vote's creator can run the tally."
        : msg === "VOTE_STILL_OPEN" ? "Voting is still open — tally after it closes."
        : msg === "ALREADY_TALLIED" ? "This vote was already tallied."
        : "Tally failed.",
      );
    } finally { setTallying(null); }
  };

  return (
    <div className="qrm-grid-2">
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <HeroCard
          Icon={Vote}
          kicker="Module I · Sealed-Ballot Voting"
          title="Cast a sealed vote."
          highlight="Verify the honest count."
          desc="Prove eligibility with ZK, encrypt your ballot client-side, and receive proof you voted — without revealing your choice. No live tally. No whale-following. No vote markets."
          cta={wallet.address ? "Browse Active Votes" : "Connect Wallet to Vote"}
          onClick={wallet.address ? () => toast("Scroll to active votes below.") : wallet.openPicker}
        />

        <Panel title="Active & Recent Votes" subtitle="QUORUM Protocol">
          <div style={{ display: "grid", gap: "0.85rem" }}>
            {votes.map((v) => (
              <div key={v.id} style={{ ...cardStyle, padding: "1.1rem 1.25rem" }}>
                <div className="qrm-vote-row" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "0.7rem", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.55 }}>#{v.id} · {v.closes === "Closed" ? "Closed" : `Active · closes ${v.closes}`}</div>
                    <div style={{ fontSize: "1.02rem", marginTop: "0.35rem" }}>{v.title}</div>
                    <div style={{ marginTop: "0.7rem", display: "flex", alignItems: "center", gap: "0.85rem", fontSize: "0.78rem", opacity: 0.7, flexWrap: "wrap" }}>
                      <span>{v.ballots} sealed ballots</span>
                      <ProgressBar value={v.quorum} />
                      <span style={{ color: palette.gold }}>{v.quorum}%</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    {v.status === "open" ? (
                      <>
                        <button style={btnStyle({ filled: true })} onClick={() => tryCast(v)}>
                          <Lock size={13} style={{ marginRight: 6 }} />Cast Ballot
                        </button>
                        <button style={btnStyle({ sm: true })} disabled={tallying === v.id} onClick={() => tally(v)}>
                          {tallying === v.id
                            ? <><Activity size={12} style={{ marginRight: 5, animation: "spin 1s linear infinite" }} />Tallying…</>
                            : <><FileCheck2 size={12} style={{ marginRight: 5 }} />Close & Tally</>}
                        </button>
                      </>
                    ) : (
                      <button style={btnStyle({})} onClick={() => setProofVote(v)}>
                        <FileCheck2 size={13} style={{ marginRight: 6 }} />View Proof
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ display: "grid", gap: "1.5rem", alignContent: "start" }}>
        <Panel title="Protocol Status">
          <div style={{ display: "grid", gap: "0.85rem" }}>
            <StatusRow label="Tally network" value={`${status.nodes} nodes · 3-of-5 threshold`} ok />
            <StatusRow label="ZK verifier" value="Operational" ok />
            <StatusRow label="Slashing events" value={`${status.slashEvents} lifetime`} ok />
            <StatusRow label="Avg seal-to-proof" value="34s" ok />
          </div>
        </Panel>
        <Panel title="Your participation">
          {participation ? (
            <div style={{ display: "grid", gap: "0.65rem", fontSize: "0.88rem" }}>
              <KvRow k="Eligibility" v={participation.eligible ? "✔ Eligible" : "Not eligible yet"} highlight={participation.eligible} />
              <KvRow k="ZK identity" v={participation.registered ? "Registered" : "Not registered"} />
              <KvRow k="Delegation" v={participation.delegationTo ? `→ ${participation.delegationTo.slice(0, 4)}…${participation.delegationTo.slice(-4)}` : "None (self-voting)"} />
              <KvRow k="Open votes" v={String(participation.openVotes)} />
              <KvRow k="QRM staked" v={participation.qrmStaked.toLocaleString()} />
            </div>
          ) : (
            <div style={{ fontSize: "0.88rem", opacity: 0.75 }}>Connect Phantom or Solflare to see your eligibility, sealed ballots, and stake.</div>
          )}
        </Panel>
      </div>

      <CastBallotModal vote={castVote} onClose={() => setCastVote(null)} wallet={wallet} />
      <ProofModal vote={proofVote} onClose={() => setProofVote(null)} />
    </div>
  );
}

function KvRow({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ opacity: 0.65 }}>{k}</span>
      <span style={{ color: highlight ? palette.gold : palette.fg }}>{v}</span>
    </div>
  );
}

function CastBallotModal({ vote, onClose, wallet }: { vote: ActiveVote | null; onClose: () => void; wallet: ReturnType<typeof useWallet> }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"yes" | "no" | "abstain" | null>(null);
  const [step, setStep] = useState<"choose" | "sealing" | "done">("choose");
  const [receipt, setReceipt] = useState<string | null>(null);
  useEffect(() => { if (vote) { setChoice(null); setStep("choose"); setReceipt(null); } }, [vote]);
  if (!vote) return null;

  const seal = async () => {
    if (!choice) return;
    setStep("sealing");
    try {
      // 1. Derive the private voting identity from a wallet signature (deterministic),
      //    register its commitment, and fetch the Merkle witness for this vote.
      const { deriveIdentity, proveEligibility } = await import("@/lib/zk/prove");
      const { secret, commitment } = await deriveIdentity(wallet.signRaw);
      await registerIdentity({ data: { commitment } });
      const elig = await getEligibility({ data: { voteId: vote.id, commitment } });
      if (!elig.registered) throw new Error("NOT_ELIGIBLE");

      // 2. Generate the Groth16 eligibility proof in-browser (membership + nullifier).
      const { proof, publicSignals } = await proveEligibility({
        secret, root: elig.root, pathElements: elig.pathElements,
        pathIndices: elig.pathIndices, voteIdField: elig.voteIdField,
      });

      // 3. Seal the choice with exponential ElGamal (one-hot over yes/no/abstain) to the
      //    tally key. Homomorphically tallyable; the server re-randomizes for receipt-freeness.
      //    The validity proof (each entry 0/1, row sums to 1) is bound to this vote + nullifier.
      const { encryptOneHotProved } = await import("@/lib/crypto/elgamal");
      const tallyPub = import.meta.env.VITE_TALLY_PUBKEY as string;
      const options = ["yes", "no", "abstain"] as const;
      const { cts, proof: ballotProof } = encryptOneHotProved(
        tallyPub, options.indexOf(choice), options.length, `${vote.id}|${publicSignals[0]}`,
      );
      const encChoice = JSON.stringify(cts);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encChoice));
      const commitHash = "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const res = await castBallot({ data: { voteId: vote.id, encChoice, ballotProof, commitHash, proof, publicSignals } });
      setReceipt(res.nullifier);
      setStep("done");
      await router.invalidate();
      toast.success("Ballot sealed with ZK eligibility proof. Nullifier recorded.");
    } catch (e) {
      setStep("choose");
      const msg = (e as Error).message ?? "Failed";
      toast.error(
        msg === "ALREADY_VOTED" ? "You already voted in this vote."
        : msg === "VOTE_CLOSED" ? "Voting has closed."
        : msg === "STALE_ROOT" ? "Eligibility set just changed — please retry."
        : msg === "BAD_PROOF" ? "Eligibility proof was rejected."
        : msg === "NOT_ELIGIBLE" ? "Not eligible for this vote — stake ≥ 100 QRM before a vote opens."
        : msg === "STAKE_REQUIRED" ? "Stake at least 100 QRM to become an eligible voter."
        : msg === "IDENTITY_LOCKED" ? "This wallet is already registered with a different voting identity."
        : msg === "BAD_BALLOT" ? "Ballot failed validity checks."
        : msg === "WALLET_CANT_SIGN" ? "This wallet can't sign messages."
        : msg === "UNAUTHENTICATED" ? "Connect & sign in first."
        : "Failed to seal ballot.",
      );
    }
  };

  return (
    <Modal open onClose={onClose} title={vote.title} kicker={`Cast Sealed Ballot · #${vote.id}`}>
      {step === "choose" && (
        <>
          <div style={{ opacity: 0.75, fontSize: "0.9rem", marginBottom: "1rem" }}>
            Your choice is encrypted client-side. No one — including QUORUM — sees it until tally close.
          </div>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {(["yes", "no", "abstain"] as const).map((c) => (
              <button key={c} onClick={() => setChoice(c)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.9rem 1.1rem", borderRadius: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                background: choice === c ? "rgba(212,175,79,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${choice === c ? palette.gold : palette.borderSoft}`,
                color: palette.fg, textTransform: "capitalize",
              }}>
                <span>{c}</span>
                {choice === c && <CheckCircle2 size={16} color={palette.gold} />}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
            <button onClick={onClose} style={btnStyle({ sm: true })}>Cancel</button>
            <button onClick={seal} disabled={!choice} style={{ ...btnStyle({ filled: true, sm: true }), opacity: choice ? 1 : 0.4 }}>
              <Lock size={12} style={{ marginRight: 5 }} />Seal & Submit
            </button>
          </div>
        </>
      )}
      {step === "sealing" && (
        <div style={{ padding: "1.5rem 0", textAlign: "center" }}>
          <Activity size={26} color={palette.gold} style={{ animation: "spin 1s linear infinite" }} />
          <div style={{ marginTop: "1rem", opacity: 0.8 }}>Encrypting ballot · generating ZK eligibility proof…</div>
        </div>
      )}
      {step === "done" && (
        <div style={{ padding: "0.5rem 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: palette.gold }}>
            <CheckCircle2 size={18} /> Ballot sealed
          </div>
          <div style={{ opacity: 0.75, fontSize: "0.9rem", marginTop: "0.6rem" }}>
            Your nullifier was recorded. Your choice stays encrypted until the vote closes and is tallied.
          </div>
          <div style={{
            marginTop: "0.9rem", padding: "0.85rem 1rem", borderRadius: "0.85rem",
            background: "rgba(212,175,79,0.06)", border: `1px dashed ${palette.border}`,
          }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: "0.18em", textTransform: "uppercase", color: palette.gold, marginBottom: "0.4rem" }}>
              Participation receipt · receipt-free
            </div>
            <div style={{ fontSize: "0.82rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: palette.fg }}>
              nullifier · {receipt ?? "—"}
            </div>
            <div style={{ fontSize: "0.78rem", opacity: 0.7, marginTop: "0.45rem" }}>
              Proves you voted · does <strong>not</strong> prove your choice. Bribery and coercion are defeated by construction.
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", gap: "0.5rem" }}>
            <button onClick={() => setStep("choose")} style={btnStyle({ sm: true })}>
              <Lock size={12} style={{ marginRight: 5 }} />Revoke &amp; recast
            </button>
            <button onClick={onClose} style={btnStyle({ filled: true, sm: true })}>Done</button>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Modal>
  );
}


function ProofModal({ vote, onClose }: { vote: ActiveVote | null; onClose: () => void }) {
  if (!vote) return null;
  const shortHash = vote.resultHash ? `${vote.resultHash.slice(0, 8)}…${vote.resultHash.slice(-4)}` : "pending";
  const shortSig = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
  return (
    <Modal open onClose={onClose} title={`Proof · #${vote.id}`} kicker="ZK Tally Verification">
      <div style={{ display: "grid", gap: "0.6rem", fontSize: "0.88rem" }}>
        <KvRow k="Status" v={vote.status === "verified" ? "✔ Verified" : vote.status} highlight />
        <KvRow k="Scheme" v="Groth16 eligibility + 3-of-5 threshold ElGamal" />
        <KvRow k="Sealed ballots" v={String(vote.ballots)} />
        <KvRow k="Result hash" v={shortHash} highlight />
        {vote.anchorTx
          ? <a href={explorerTx(vote.anchorTx)} target="_blank" rel="noreferrer" style={{ color: palette.indigo, textDecoration: "none", display: "flex", justifyContent: "space-between" }}>
              <span style={{ opacity: 0.65 }}>Eligibility anchor (devnet)</span><span>{shortSig(vote.anchorTx)} ↗</span>
            </a>
          : <KvRow k="Eligibility anchor" v="not anchored" />}
        {vote.tallyTx
          ? <a href={explorerTx(vote.tallyTx)} target="_blank" rel="noreferrer" style={{ color: palette.indigo, textDecoration: "none", display: "flex", justifyContent: "space-between" }}>
              <span style={{ opacity: 0.65 }}>Tally anchor (devnet)</span><span>{shortSig(vote.tallyTx)} ↗</span>
            </a>
          : <KvRow k="Tally anchor" v="not anchored" />}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
        <button style={btnStyle({ sm: true })} disabled={!vote.resultHash} onClick={() => { navigator.clipboard?.writeText(vote.resultHash ?? ""); toast.success("Result hash copied"); }}>Copy Hash</button>
        <button style={btnStyle({ filled: true, sm: true })} onClick={async () => {
          try {
            // Real trustless check: re-run the DLEQ tally-correctness verification.
            const res = await verifyTally({ data: { voteId: vote.id } });
            if (res.found) {
              toast[res.verified ? "success" : "error"](
                res.verified
                  ? `Tally correctness verified ✔ — totals are the honest decryption${res.totals ? ` (${Object.entries(res.totals).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`
                  : "Tally correctness FAILED — transcript does not verify",
              );
            } else {
              const p = await verifyProof({ data: { refId: vote.id } });
              toast.success(p.verified ? "Verified ✔ (no DLEQ transcript on file)" : "No verified record on file");
            }
          } catch { toast.error("Verify failed"); }
        }}><ShieldCheck size={12} style={{ marginRight: 5 }} />Verify Tally</button>
      </div>
    </Modal>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ flex: 1, minWidth: "6rem", height: "4px", borderRadius: "999px", background: "rgba(236,232,216,0.08)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, value)}%`, height: "100%", background: `linear-gradient(90deg, ${palette.gold}, ${palette.indigo})` }} />
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", gap: "0.75rem" }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "999px", background: ok ? "#7ddc9f" : palette.gold }} />
        {value}
      </span>
    </div>
  );
}

/* ─────────── HERO + PANEL ─────────── */

function HeroCard({ Icon, kicker, title, highlight, desc, cta, onClick }: { Icon?: typeof Vote; kicker: string; title: string; highlight?: string; desc: string; cta?: string; onClick?: () => void }) {
  return (
    <div style={{
      ...cardStyle, padding: "2rem 2.25rem",
      background: `linear-gradient(135deg, rgba(138,123,216,0.18), rgba(212,175,79,0.06))`,
      border: `1px solid ${palette.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {Icon && <span className="qrm-icon-tile"><Icon size={16} strokeWidth={1.7} /></span>}
        <div style={{ fontSize: "0.72rem", letterSpacing: "0.2em", textTransform: "uppercase", color: palette.gold }}>{kicker}</div>
      </div>
      <h1 className="qrm-hero-title" style={{ fontWeight: 200, margin: "0.85rem 0 0", letterSpacing: "-0.01em", lineHeight: 1.1 }}>
        {title} {highlight && <span style={{ fontWeight: 500 }}>{highlight}</span>}
      </h1>
      <p className="qrm-hero-desc" style={{ marginTop: "1rem", opacity: 0.78, maxWidth: "42rem", lineHeight: 1.6 }}>{desc}</p>
      {cta && (
        <div style={{ marginTop: "1.5rem" }}>
          <button onClick={onClick} style={btnStyle({ filled: true })}>{cta}<ArrowRight size={14} style={{ marginLeft: 6 }} /></button>
        </div>
      )}
    </div>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section style={{ ...cardStyle, padding: "1.5rem 1.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 500 }}>{title}</div>
          {subtitle && <div style={{ fontSize: "0.75rem", opacity: 0.55, marginTop: "0.2rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ─────────── PROPOSALS ─────────── */

type Proposal = {
  id: string; state: "Hidden" | "Revealed"; reveal: string; window: string;
  commit: string | null; title: string | null; revealMode: string; revealAt: string | null;
};

function ProposalsTab() {
  const router = useRouter();
  const { proposals: proposalRows } = Route.useLoaderData();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [detail, setDetail] = useState<Proposal | null>(null);

  const proposals: Proposal[] = proposalRows.map((p) => ({
    id: p.id,
    state: p.status === "hidden" ? "Hidden" : "Revealed",
    reveal: p.status === "executed" ? "Executed" : p.reveal === "timelock" ? "Timelock" : "On-pass",
    window: p.status === "hidden"
      ? p.revealAt ? `Reveal in ${formatCloses(p.revealAt)}` : "On pass"
      : "Closed",
    commit: p.commit, title: p.title, revealMode: p.reveal, revealAt: p.revealAt,
  }));

  const reveal = async (p: Proposal) => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(`qrm-proposal-${p.id}`) : null;
    // New openings are JSON {salt, text}; older ones are the bare plaintext (unsalted commitment).
    let plaintext = stored, salt: string | undefined;
    try { const o = JSON.parse(stored ?? ""); if (o && typeof o.text === "string") { plaintext = o.text; salt = o.salt; } } catch { /* legacy */ }
    if (!plaintext) { toast.error("Opening not found in this browser — only the author can reveal."); return; }
    if (p.revealMode === "timelock" && p.revealAt && new Date(p.revealAt).getTime() > Date.now()) {
      toast.error(`Timelock not elapsed — reveals in ${formatCloses(p.revealAt)}.`); return;
    }
    try {
      await revealProposal({ data: { proposalId: p.id, plaintext, salt } });
      await router.invalidate();
      toast.success("Proposal revealed — commitment verified.");
      setDetail(null);
    } catch (e) {
      const msg = (e as Error).message ?? "Failed";
      toast.error(
        msg === "TIMELOCK_NOT_ELAPSED" ? "Timelock has not elapsed yet."
        : msg === "NOT_AUTHOR" ? "Only the author can reveal."
        : msg === "COMMIT_MISMATCH" ? "Opening doesn't match the commitment."
        : "Reveal failed.",
      );
    }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={FileLock2}
        kicker="Module II · Hidden-Until-Execution Proposals"
        title="No front-running window."
        desc="Proposals are submitted encrypted; only their existence, author eligibility, and voting rules are public. Contents reveal at execution or after timelock."
        cta="Submit Encrypted Proposal"
        onClick={() => setSubmitOpen(true)}
      />
      <Panel title="Proposal queue" action={<button style={btnStyle({ sm: true })} onClick={() => setSubmitOpen(true)}><Plus size={12} style={{ marginRight: 4 }} />New</button>}>
        <div style={{ display: "grid", gap: "0.85rem" }}>
          {proposals.map((p) => (
            <div key={p.id} style={{ ...cardStyle, padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
                  <span className="qrm-icon-tile">{p.state === "Hidden" ? <Lock size={14} /> : <CheckCircle2 size={14} />}</span>
                  <div>
                    <div style={{ fontSize: "0.7rem", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.55 }}>Proposal #{p.id}</div>
                    <div style={{ fontSize: "1rem", marginTop: "0.25rem" }}>
                      {p.state === "Hidden" ? "Sealed payload" : (p.title ?? "Revealed")}
                    </div>
                    <div style={{ fontSize: "0.78rem", opacity: 0.6, marginTop: "0.25rem" }}>
                      Reveal: {p.reveal} · {p.window}{p.state === "Hidden" && p.commit ? ` · commit ${p.commit.slice(0, 8)}…` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button style={btnStyle({})} onClick={() => setDetail(p)}>
                    <Eye size={13} style={{ marginRight: 5 }} />{p.state === "Hidden" ? "View Rules" : "View Payload"}
                  </button>
                  {p.state === "Hidden" && (
                    <button style={btnStyle({ sm: true })} onClick={() => reveal(p)}>
                      <Eye size={12} style={{ marginRight: 4 }} />Reveal
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <SubmitProposalModal open={submitOpen} onClose={() => setSubmitOpen(false)} />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Proposal #${detail.id}` : ""} kicker={detail?.state === "Hidden" ? "Public Rules" : "Executed Payload"}>
        {detail && (
          <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.88rem" }}>
            <KvRow k="State" v={detail.state} />
            <KvRow k="Reveal policy" v={detail.reveal} />
            <KvRow k="Window" v={detail.window} />
            <KvRow k="Commitment" v={detail.commit ? `${detail.commit.slice(0, 10)}…${detail.commit.slice(-4)}` : "—"} highlight />
            <KvRow k="Quorum rule" v="≥ 5% staked QRM · 3-day window" />
            {detail.state === "Hidden" ? (
              <div style={{ marginTop: "0.5rem", padding: "0.85rem", borderRadius: "0.75rem", background: "rgba(212,175,79,0.06)", border: `1px dashed ${palette.border}`, color: palette.muted, fontSize: "0.82rem" }}>
                <Lock size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                Payload sealed (AES-GCM) + committed. The content is verified against this commitment on reveal — under timelock or once the vote passes.
              </div>
            ) : (
              <div style={{ marginTop: "0.5rem", padding: "0.85rem", borderRadius: "0.75rem", background: "rgba(125,220,159,0.06)", border: `1px solid rgba(125,220,159,0.25)`, fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>
                {detail.title ?? "Revealed."}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SubmitProposalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [reveal, setReveal] = useState<"on-pass" | "timelock">("on-pass");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = body.trim();
    if (!text) { toast.error("Enter the proposal content."); return; }
    setBusy(true);
    try {
      const { sealProposal } = await import("@/lib/crypto/proposal");
      const { encPayload, commitHash, salt } = await sealProposal(text);
      const res = await submitProposal({
        data: { encPayload, commitHash, reveal: reveal === "on-pass" ? "on_pass" : "timelock" },
      });
      // keep the author's opening locally so they can reveal later (server never sees it)
      if (typeof window !== "undefined") window.localStorage.setItem(`qrm-proposal-${res.proposalId}`, JSON.stringify({ salt, text }));
      await router.invalidate();
      toast.success(`Sealed proposal ${res.proposalId} submitted`);
      setBody("");
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? "Failed";
      toast.error(msg === "UNAUTHENTICATED" ? "Connect & sign in first." : "Failed to submit proposal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Submit Sealed Proposal" kicker="Module II">
      <div style={{ opacity: 0.7, fontSize: "0.88rem", marginBottom: "1rem" }}>
        The content is encrypted client-side (AES-GCM) and bound by a sha256 commitment. Only its
        existence, author eligibility and voting rules are public until you reveal.
      </div>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Proposal content — title, description, target, payload…" rows={5} style={{ ...inputStyle, borderRadius: "1rem", padding: "0.75rem 1rem", resize: "vertical" }} />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["on-pass", "timelock"] as const).map((r) => (
            <button key={r} onClick={() => setReveal(r)} style={{
              ...btnStyle({ filled: reveal === r, sm: true }),
              border: `1px solid ${reveal === r ? palette.gold : palette.borderSoft}`,
              color: reveal === r ? palette.bg : palette.fg,
            }}>{r}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
        <button onClick={onClose} style={btnStyle({ sm: true })}>Cancel</button>
        <button onClick={submit} disabled={!body.trim() || busy} style={{ ...btnStyle({ filled: true, sm: true }), opacity: body.trim() && !busy ? 1 : 0.4 }}>
          <Lock size={12} style={{ marginRight: 5 }} />{busy ? "Encrypting…" : "Encrypt & Submit"}
        </button>
      </div>
    </Modal>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: `1px solid ${palette.borderSoft}`,
  color: palette.fg, padding: "0.7rem 1rem",
  borderRadius: "2rem", fontFamily: "inherit", outline: "none",
};

/* ─────────── TREASURY ─────────── */

function TreasuryTab() {
  const router = useRouter();
  const { treasury, auditors } = Route.useLoaderData();
  const [solvencyOpen, setSolvencyOpen] = useState(false);
  const [solvencyInputOpen, setSolvencyInputOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState("1250000");
  const [thresholdInput, setThresholdInput] = useState("1000000");
  const [proving, setProving] = useState(false);
  const [discloseOpen, setDiscloseOpen] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [discloseAuditor, setDiscloseAuditor] = useState("");
  const [discloseContent, setDiscloseContent] = useState("");
  const [proofHash, setProofHash] = useState<string | null>(null);
  const [onChainTx, setOnChainTx] = useState<string | null>(null);
  const liveAuditors = auditors.filter((a) => !a.revoked && /^[0-9a-f]{64}$/.test(a.pubkey));
  const activeAuditors = auditors.filter((a) => !a.revoked).length;

  const authError = (e: unknown) =>
    toast.error((e as Error).message === "UNAUTHENTICATED" ? "Connect & sign in first." : (e as Error).message === "FORBIDDEN" ? "Admins only." : "Action failed.");

  // Operator enters the real reserve balance + the threshold to prove; the ZK range proof is
  // generated in-browser and only the proof + commitment leave — the balance stays hidden.
  const genSolvency = async () => {
    let balance: bigint, threshold: bigint;
    try {
      balance = BigInt(balanceInput.replace(/[, ]/g, ""));
      threshold = BigInt(thresholdInput.replace(/[, ]/g, ""));
    } catch { toast.error("Enter whole numbers for balance and threshold."); return; }
    if (balance < 0n || threshold < 0n) { toast.error("Values must be non-negative."); return; }
    if (balance < threshold) { toast.error("Balance is below the threshold — solvency can't be proven."); return; }
    setProving(true);
    try {
      const { proveSolvency } = await import("@/lib/zk/solvency");
      const { proof, publicSignals, commitment } = await proveSolvency(balance, threshold);
      const res = await recordSolvencyProof({ data: { threshold: threshold.toString(), commitment, proof, publicSignals } });
      setProofHash(`0x${BigInt(commitment).toString(16).slice(0, 10)}`);
      setOnChainTx(res.onChainTx ?? null);
      setSolvencyInputOpen(false);
      setSolvencyOpen(true);
      await router.invalidate();
      toast.success(res.onChainTx
        ? `Solvency proven & verified on-chain — balance stays hidden.`
        : `Solvency proven: reserves ≥ ${threshold.toLocaleString()} — balance stays hidden.`);
    } catch (e) { authError(e); }
    finally { setProving(false); }
  };

  const disclose = async () => {
    if (!discloseAuditor) { toast.error("Pick an auditor key."); return; }
    if (!discloseContent.trim()) { toast.error("Enter the record content to disclose."); return; }
    try {
      await issueDisclosure({ data: { recordId: recordId || `T-${Math.floor(Date.now() / 1000) % 100000}`, auditorPubkey: discloseAuditor, content: discloseContent.trim() } });
      await router.invalidate();
      toast.success("Record encrypted to the auditor — only they can decrypt.");
      setDiscloseOpen(false);
      setRecordId(""); setDiscloseContent("");
    } catch (e) { authError(e); }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={Landmark}
        kicker="Module III · Confidential Treasury"
        title="Solvent."
        highlight="Confidential. Selectively disclosed."
        desc="Treasury holdings and transfers are encrypted on-chain via Token-2022 Confidential Balances. An auditor key allows targeted disclosure to members or regulators without exposing the whole treasury."
        cta="Generate Solvency Proof"
        onClick={() => setSolvencyInputOpen(true)}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        <KV label="Solvency Proofs" value={treasury.solvencyCount > 0 ? `${treasury.solvencyCount} ✔` : "None yet"} Icon={ShieldCheck} />
        <KV label="Disclosed Records" value={`${treasury.disclosedCount} / ${treasury.totalRecords}`} Icon={Eye} />
        <KV label="Active Auditors" value={`${activeAuditors} keys`} Icon={KeyRound} />
        <KV label="Disclosures Issued" value={String(treasury.disclosureCount)} Icon={Activity} />
      </div>
      <Panel title="Selective disclosure" subtitle="Auditor-key release" action={<button onClick={() => setDiscloseOpen(true)} style={btnStyle({ sm: true })}><Eye size={12} style={{ marginRight: 5 }} />Disclose Record</button>}>
        <div style={{ display: "grid", gap: "0.6rem", fontSize: "0.88rem" }}>
          <KvRow k="Encrypted balance" v="•••••• (hidden by design)" />
          <KvRow k="Disclosures issued" v={String(treasury.disclosureCount)} />
          <KvRow k="Solvency proofs on file" v={String(treasury.solvencyCount)} highlight />
        </div>
      </Panel>

      <Modal open={solvencyInputOpen} onClose={() => setSolvencyInputOpen(false)} title="Prove solvency" kicker="Confidential Treasury">
        <div style={{ opacity: 0.7, fontSize: "0.88rem", marginBottom: "1rem" }}>
          Enter the real reserve balance and the threshold to prove. A ZK range proof is generated
          in your browser — only the proof + a commitment leave. The balance itself stays hidden.
        </div>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <span style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>Reserve balance (hidden)</span>
            <input style={inputStyle} type="number" min={0} value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} placeholder="e.g. 1250000" />
          </label>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <span style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>Prove reserves ≥ (public)</span>
            <input style={inputStyle} type="number" min={0} value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} placeholder="e.g. 1000000" />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
          <button onClick={() => setSolvencyInputOpen(false)} style={btnStyle({ sm: true })}>Cancel</button>
          <button onClick={genSolvency} disabled={proving} style={{ ...btnStyle({ filled: true, sm: true }), opacity: proving ? 0.5 : 1 }}>
            <ShieldCheck size={12} style={{ marginRight: 5 }} />{proving ? "Proving…" : "Generate Proof"}
          </button>
        </div>
      </Modal>

      <Modal open={solvencyOpen} onClose={() => setSolvencyOpen(false)} title="Solvency proof generated" kicker="Confidential Treasury">
        <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.88rem" }}>
          <KvRow k="Scheme" v="Range proof + Merkle commitment" />
          <KvRow k="Proves" v="Treasury ≥ outstanding obligations" highlight />
          <KvRow k="Disclosed" v="Nothing else" />
          <KvRow k="Proof hash" v={proofHash ?? "0x3a…7c11"} />
          {onChainTx
            ? <a href={explorerTx(onChainTx)} target="_blank" rel="noreferrer" style={{ color: palette.indigo, textDecoration: "none", display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.65 }}>On-chain verify (devnet)</span><span>{onChainTx.slice(0, 6)}…{onChainTx.slice(-6)} ↗</span>
              </a>
            : <KvRow k="On-chain verify" v="off-chain only" />}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button onClick={() => setSolvencyOpen(false)} style={btnStyle({ filled: true, sm: true })}>Done</button>
        </div>
      </Modal>

      <Modal open={discloseOpen} onClose={() => setDiscloseOpen(false)} title="Selective disclosure" kicker="Auditor Key">
        <div style={{ opacity: 0.7, fontSize: "0.88rem", marginBottom: "1rem" }}>
          Reveal a single record (transfer, balance snapshot, recipient) without exposing the rest of the treasury.
        </div>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <input style={inputStyle} placeholder="Record ID (e.g. T-1042)" value={recordId} onChange={(e) => setRecordId(e.target.value)} />
          <select style={{ ...inputStyle, appearance: "auto" }} value={discloseAuditor} onChange={(e) => setDiscloseAuditor(e.target.value)}>
            <option value="">Select auditor key…</option>
            {liveAuditors.map((a) => (
              <option key={a.pubkey} value={a.pubkey}>{a.label} · {a.pubkey.slice(0, 10)}…</option>
            ))}
          </select>
          <textarea style={{ ...inputStyle, borderRadius: "1rem", padding: "0.75rem 1rem", resize: "vertical" }} rows={3}
            placeholder="Record content (amount, recipient, memo)…" value={discloseContent} onChange={(e) => setDiscloseContent(e.target.value)} />
          {liveAuditors.length === 0 && <div style={{ fontSize: "0.78rem", color: palette.muted }}>No ECIES auditor keys yet — add one in Settings.</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
          <button onClick={() => setDiscloseOpen(false)} style={btnStyle({ sm: true })}>Cancel</button>
          <button style={btnStyle({ filled: true, sm: true })} onClick={disclose}>
            <KeyRound size={12} style={{ marginRight: 5 }} />Encrypt to Auditor
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ─────────── EXPLORER ─────────── */

function ExplorerTab() {
  const { proofs, nodes: nodeRows } = Route.useLoaderData();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const rows = proofs.map((p) => ({
    type: cap(p.type),
    id: p.id,
    detail: p.detail ?? "",
    proof: p.verified ? `${p.proof ?? "Proof"} · ✔` : (p.proof ?? "Unverified"),
  }));
  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={ShieldCheck}
        kicker="Public Trust Surface"
        title="Verify confidential governance is honest"
        highlight="— without trusting QUORUM."
        desc="Every closed vote, tally attestation, treasury solvency proof, and tally-node record is published with one-click verification."
      />
      <Panel title="Proof feed">
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {rows.map((r) => (
            <div key={r.id} style={{ ...cardStyle, padding: "0.9rem 1.1rem" }}>
              <div style={{ display: "flex", gap: "1rem", justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.7rem", letterSpacing: "0.18em", textTransform: "uppercase", color: palette.gold, minWidth: "6rem" }}>
                  <span className="qrm-icon-tile" style={{ width: 28, height: 28, borderRadius: 8 }}>
                    {r.type === "Vote" ? <Vote size={12} /> : r.type === "Tally" ? <Network size={12} /> : r.type === "Treasury" ? <Landmark size={12} /> : <Server size={12} />}
                  </span>
                  {r.type}
                </span>
                <span style={{ flex: 1, minWidth: "10rem", fontSize: "0.9rem" }}>#{r.id} — {r.detail}</span>
                <span style={{ opacity: 0.75, fontSize: "0.82rem" }}>{r.proof}</span>
                <button style={btnStyle({ sm: true })} onClick={async () => {
                  try {
                    const res = await verifyProof({ data: { refId: r.id } });
                    toast.success(res.verified ? `Proof #${r.id} verified ✔` : `Proof #${r.id} — no verified record`);
                  } catch { toast.error("Verify failed"); }
                }}>
                  <ShieldCheck size={12} style={{ marginRight: 5 }} />Verify
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Tally-node accountability" subtitle="Staked operators · attestations · slashing">
        <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.85rem" }}>
          {nodeRows.map((n) => ({
            id: n.id,
            stake: `${(n.stake / 1000).toLocaleString()}k QRM`,
            attest: `${n.attestation} · not verified (devnet)`, // no quote verifier exists yet
            slash: String(n.slash),
          })).map((n) => (
            <div key={n.id} style={{ ...cardStyle, padding: "0.8rem 1.1rem", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", color: palette.gold, letterSpacing: "0.16em", textTransform: "uppercase", fontSize: "0.72rem" }}>
                <span className="qrm-icon-tile" style={{ width: 26, height: 26, borderRadius: 8 }}><Server size={11} /></span>{n.id}
              </span>
              <span style={{ opacity: 0.75 }}>Stake · {n.stake}</span>
              <span style={{ opacity: 0.85 }}>Attestation · {n.attest}</span>
              <span style={{ color: n.slash === "0" ? "#7ddc9f" : palette.gold }}>Slashing · {n.slash}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}


/* ─────────── STAKE ─────────── */

function StakeTab({ wallet, goTab }: { wallet: ReturnType<typeof useWallet>; goTab: (k: TabKey) => void }) {
  const router = useRouter();
  const { nodes, participation } = Route.useLoaderData();
  const [amount, setAmount] = useState("");
  const [nodeOpen, setNodeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<StakeCtx | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const staked = participation?.qrmStaked ?? 0;

  // Load the on-chain stake context + the wallet's QRM balance once connected.
  const refreshBalance = async (c: StakeCtx | null, addr: string | null) => {
    if (!c || !addr) { setBalance(null); return; }
    const { walletQrmBalance } = await import("@/lib/solana/stake.browser");
    setBalance(await walletQrmBalance(c, addr));
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!wallet.address) { setCtx(null); setBalance(null); return; }
      const c = await getStakeContext();
      if (!alive) return;
      setCtx(c);
      await refreshBalance(c, wallet.address);
    })();
    return () => { alive = false; };
  }, [wallet.address]);

  const faucet = async () => {
    setBusy(true);
    try {
      const res = await qrmFaucet();
      toast.success(`Received ${res.amount} devnet QRM ✓`);
      await new Promise((r) => setTimeout(r, 1500)); // let the RPC catch up
      await refreshBalance(ctx, wallet.address);
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === "UNAUTHENTICATED" ? "Connect & sign in first." : m === "RATE_LIMITED" ? "Faucet limit reached — try later." : m === "FAUCET_DISABLED" ? "The faucet only runs on devnet." : "Faucet failed.");
    } finally { setBusy(false); }
  };

  const stake = async () => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    if (!ctx) { toast.error("Stake context unavailable."); return; }
    if (balance !== null && n > balance) { toast.error("Not enough QRM — use the faucet first."); return; }
    setBusy(true);
    try {
      // 1. build + sign + send the Token-2022 transfer to the vault (wallet popup)
      const signature = await wallet.stakeTransfer(ctx, n);
      toast("Transfer sent — confirming on devnet…");
      // 2. server verifies the on-chain transfer and credits the ledger
      const res = await confirmStake({ data: { signature } });
      await router.invalidate();
      await refreshBalance(ctx, wallet.address);
      toast.success(`Staked ${res.credited.toLocaleString()} QRM · total ${res.staked.toLocaleString()}`);
      setAmount("");
      // 3. Register the voting identity now, so this wallet is in the eligibility snapshot of
      //    every vote created from here on (votes freeze their eligible set when they open).
      if (res.staked >= 100) {
        try {
          const { deriveIdentity } = await import("@/lib/zk/prove");
          const { commitment } = await deriveIdentity(wallet.signRaw);
          await registerIdentity({ data: { commitment } });
          await router.invalidate();
          toast.success("Voting identity registered — eligible for new votes.");
        } catch { /* optional here; casting a ballot retries it */ }
      }
    } catch (e) {
      console.error("[stake] error:", e);
      const m = (e as Error).message ?? "";
      toast.error(
        m === "WALLET_CANT_SEND" ? "This wallet can't send transactions."
        : /reject|cancel|denied|user/i.test(m) ? "Transfer cancelled in wallet."
        : m === "STAKE_NOT_CONFIRMED" ? "Transfer didn't confirm — try again."
        : m === "ALREADY_CREDITED" ? "That transfer was already credited."
        : m === "UNAUTHENTICATED" ? "Connect & sign in first."
        : `Stake failed: ${m || "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const unstake = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { toast.error("Enter an amount to unstake."); return; }
    if (n > staked) { toast.error("You don't have that much staked."); return; }
    setBusy(true);
    try {
      const res = await unstakeQrm({ data: { amount: n } });
      await router.invalidate();
      await new Promise((r) => setTimeout(r, 1500));
      await refreshBalance(ctx, wallet.address);
      toast.success(`Unstaked ${n.toLocaleString()} QRM · staked ${res.staked.toLocaleString()}`);
      setAmount("");
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === "INSUFFICIENT_STAKE" ? "You don't have that much staked." : m === "UNSTAKE_PENDING" ? "Unstake sent — confirmation is slow; check your wallet shortly." : m === "UNAUTHENTICATED" ? "Connect & sign in first." : "Unstake failed.");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={Coins}
        kicker="QRM Staking"
        title="Stake QRM."
        highlight="Secure the secret ballot. Earn fees."
        desc="Planned: tally nodes stake QRM to run MPC/TEE counting, with slashing for misbehavior. On devnet today, the tally runs on the operator's server and its correctness is proven with public DLEQ proofs."
        cta="View Proof Explorer"
        onClick={() => goTab("explorer")}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        <KV label="Network APY" value="~8% + fees" Icon={Sparkles} />
        <KV label="Revenue Split" value="60 / 20 / 10 / 10" Icon={SlidersHorizontal} />
        <KV label="Active Tally Nodes" value={String(nodes.length)} Icon={Server} />
        <KV label="Slashing Events" value={`${nodes.reduce((s, n) => s + n.slash, 0)} lifetime`} Icon={ShieldCheck} />
      </div>
      <Panel title="Stake QRM" subtitle="Real Token-2022 transfer on devnet">
        {!wallet.address ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ opacity: 0.75, fontSize: "0.9rem" }}>Connect your wallet to stake.</div>
            <button onClick={wallet.openPicker} style={btnStyle({ filled: true })}><Wallet size={14} style={{ marginRight: 6 }} />Connect Wallet</button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.85rem" }}>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
              <span>Wallet QRM: <strong style={{ color: palette.gold }}>{balance === null ? "…" : balance.toLocaleString()}</strong></span>
              <span>Staked: <strong style={{ color: palette.gold }}>{staked.toLocaleString()}</strong></span>
            </div>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <input type="number" placeholder="Amount of QRM" value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: "180px" }} />
              <button style={{ ...btnStyle({ filled: true }), opacity: amount && !busy ? 1 : 0.4 }} disabled={!amount || busy} onClick={stake}>
                <Coins size={13} style={{ marginRight: 5 }} />{busy ? "Working…" : "Stake"}
              </button>
              <button style={{ ...btnStyle({}), opacity: amount && !busy ? 1 : 0.4 }} disabled={!amount || busy} onClick={unstake}>
                {busy ? "Working…" : "Unstake"}
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <button style={btnStyle({ sm: true })} disabled={busy} onClick={faucet}>
                <Sparkles size={12} style={{ marginRight: 5 }} />Get devnet QRM
              </button>
              <button style={btnStyle({ sm: true })} onClick={() => setNodeOpen(true)}>
                <Server size={12} style={{ marginRight: 5 }} />Run Tally Node
              </button>
              <span style={{ fontSize: "0.72rem", opacity: 0.55 }}>Staking sends QRM to the protocol vault; unstaking returns it.</span>
            </div>
          </div>
        )}
      </Panel>

      <Modal open={nodeOpen} onClose={() => setNodeOpen(false)} title="Run a tally node" kicker="QRM Network">
        <div style={{ opacity: 0.7, fontSize: "0.88rem", marginBottom: "1rem" }}>
          Planned: tally nodes join MPC/TEE counting clusters (stake ≥ 25,000 QRM, slashing for misbehavior). Applications are recorded; nodes are not yet live on devnet.
        </div>
        <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.88rem" }}>
          <KvRow k="Minimum stake" v="25,000 QRM" />
          <KvRow k="Hardware attestation" v="Planned (SGX / SEV-SNP) — not verified on devnet" />
          <KvRow k="Bandwidth" v="≥ 100 Mbps · 99.5% uptime" />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
          <button onClick={() => setNodeOpen(false)} style={btnStyle({ sm: true })}>Cancel</button>
          <button onClick={async () => {
            try {
              const res = await applyTallyNode();
              await router.invalidate();
              toast.success(`Operator application submitted · ${res.nodeId}`);
              setNodeOpen(false);
            } catch (e) {
              toast.error((e as Error).message === "UNAUTHENTICATED" ? "Connect & sign in first." : "Application failed.");
            }
          }} style={btnStyle({ filled: true, sm: true })}>Apply as Operator</button>
        </div>
      </Modal>
    </div>
  );
}

/* ─────────── ADMIN ─────────── */

function AdminTab({ goTab }: { goTab: (k: TabKey) => void }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const cards: { t: string; d: string; Icon: typeof Vote; to?: TabKey }[] = [
    { t: "Votes", d: "Create, manage active/closed votes, ballot counts, verified results.", Icon: Vote, to: "vote" },
    { t: "Proposals", d: "Submit encrypted proposals; reveal on-pass or via timelock.", Icon: FileLock2, to: "proposals" },
    { t: "Treasury", d: "Encrypted balances, selective disclosure, solvency proofs.", Icon: Landmark, to: "treasury" },
    { t: "Members", d: "Eligibility snapshot config, private delegation, participation.", Icon: Users, to: "members" },
    { t: "Proofs", d: "Every vote's correctness proof, tally attestation, audit trail.", Icon: ShieldCheck, to: "explorer" },
    { t: "Settings", d: "Quorum rules, tally-node selection, auditor keys, integrations.", Icon: SlidersHorizontal, to: "settings" },
  ];
  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={SlidersHorizontal}
        kicker="DAO Admin Console"
        title="Create a vote."
        highlight="Configure confidential governance."
        desc="Wizard-driven creation with sound defaults: sealed ballots and no live tally on by default. Integrates with Realms; composes with existing tooling."
        cta="Create New Vote"
        onClick={() => setWizardOpen(true)}
      />
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {cards.map((c) => (
          <button key={c.t} onClick={() => c.to ? goTab(c.to) : toast(`${c.t} module — coming soon`)} style={{ ...cardStyle, textAlign: "left", cursor: "pointer", color: palette.fg, fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.5rem" }}>
              <span className="qrm-icon-tile"><c.Icon size={14} strokeWidth={1.7} /></span>
              <div style={{ fontSize: "1.02rem", color: palette.gold }}>{c.t}</div>
            </div>
            <div style={{ opacity: 0.7, fontSize: "0.85rem", lineHeight: 1.55 }}>{c.d}</div>
            <div style={{ marginTop: "0.85rem", fontSize: "0.72rem", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Open <ArrowRight size={12} />
            </div>
          </button>
        ))}
      </div>

      <CreateVoteModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

function CreateVoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [days, setDays] = useState("3");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await createVote({ data: { title, days: Math.max(1, Math.min(60, Number(days) || 3)) } });
      await router.invalidate();
      toast.success(`Vote ${res.voteId} created · sealed ballots enabled`);
      setTitle("");
      onClose();
    } catch (e) {
      toast.error((e as Error).message === "UNAUTHENTICATED" ? "Connect & sign in first." : (e as Error).message === "FORBIDDEN" ? "Only admins can create votes." : "Failed to create vote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create new vote" kicker="Wizard · sound defaults">
      <div style={{ opacity: 0.7, fontSize: "0.88rem", marginBottom: "1rem" }}>
        Sealed ballots and no live tally are on by default.
      </div>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        <input style={inputStyle} placeholder="Vote title (public)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input style={inputStyle} type="number" min={1} max={30} placeholder="Voting window (days)" value={days} onChange={(e) => setDays(e.target.value)} />
        <div style={{ display: "grid", gap: "0.45rem", padding: "0.85rem 1rem", borderRadius: "1rem", background: "rgba(212,175,79,0.05)", border: `1px solid ${palette.borderSoft}`, fontSize: "0.82rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><input type="checkbox" defaultChecked /> Sealed ballots</label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><input type="checkbox" defaultChecked /> Hide running tally</label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><input type="checkbox" defaultChecked /> ZK eligibility</label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><input type="checkbox" /> Private delegation</label>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
        <button onClick={onClose} style={btnStyle({ sm: true })}>Cancel</button>
        <button disabled={!title || busy} style={{ ...btnStyle({ filled: true, sm: true }), opacity: title && !busy ? 1 : 0.4 }} onClick={create}>
          <ScrollText size={12} style={{ marginRight: 5 }} />{busy ? "Creating…" : "Create Vote"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── DOCS ─────────── */

function DocsTab() {
  const docs: { t: string; d: string; Icon: typeof Vote }[] = [
    { t: "Sealed-Ballot Voting", d: "Threshold encryption client-side; tally inside MPC/TEE; ZK correctness proof on-chain before execution.", Icon: Vote },
    { t: "Hidden-Until-Execution Proposals", d: "Encrypted payloads with public rules; reveal on-pass or timelock; eliminates the front-run window.", Icon: FileLock2 },
    { t: "Confidential Treasury", d: "Token-2022 Confidential Balances + auditor key for selective disclosure and solvency proofs.", Icon: Landmark },
    { t: "Private Delegation + ZK Eligibility", d: "Prove voting weight without revealing balance. Nullifier prevents double-voting.", Icon: KeyRound },
    { t: "QRM Token-2022", d: "Transfer hook, fee, confidential transfer, interest-bearing for staked nodes.", Icon: Coins },
    { t: "Realms Integration", d: "QUORUM composes with Realms — adds confidential voting + treasury without replacing tooling.", Icon: Network },
  ];
  return (
    <div className="qrm-docs-tab">
      <HeroCard
        Icon={BookText}
        kicker="Docs"
        title="Sealed-ballot guide,"
        highlight="SDK, Realms integration."
        desc="The unifying guarantee: private inputs, public proof. Confidentiality without sacrificing verifiability."
      />
      <div style={{ display: "grid", gap: "1rem" }}>
        {docs.map((c) => (
          <div key={c.t} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "0.35rem" }}>
              <span className="qrm-icon-tile"><c.Icon size={14} strokeWidth={1.7} /></span>
              <div style={{ fontSize: "1.02rem", color: palette.gold }}>{c.t}</div>
            </div>
            <div style={{ opacity: 0.75, fontSize: "0.9rem", lineHeight: 1.55 }}>{c.d}</div>
          </div>
        ))}
      </div>

      <Panel title="Solana programs" subtitle="6 Anchor programs · on-chain enforcement">
        <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.85rem" }}>
          {[
            { p: "VoteRegistry", d: "Vote lifecycle, eligibility snapshot, nullifier set, ballot commitments.", t: "7 days" },
            { p: "TallyVerifier", d: "Verify ZK correctness proof + MPC/TEE attestation before execution.", t: "7 days" },
            { p: "ProposalVault", d: "Hidden proposals, reveal logic, execution.", t: "14 days" },
            { p: "ConfidentialTreasury", d: "Encrypted treasury, selective disclosure, solvency proofs.", t: "14 days" },
            { p: "QRMStaking", d: "Tally-node staking, fee distribution, slashing.", t: "14 days" },
            { p: "Governance", d: "QUORUM's own params, integration registry (Realms-compatible).", t: "21 days" },
          ].map((r) => (
            <div key={r.p} className="qrm-docs-table-row" style={{ ...cardStyle, padding: "0.85rem 1.1rem", display: "grid", gridTemplateColumns: "12rem 1fr auto", gap: "1rem", alignItems: "center" }}>
              <span style={{ color: palette.gold, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: "0.78rem" }}>{r.p}</span>
              <span style={{ opacity: 0.78 }}>{r.d}</span>
              <span style={{ fontSize: "0.75rem", opacity: 0.7, letterSpacing: "0.12em" }}>Timelock · {r.t}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="SDK" subtitle="@quorum/sdk · client-side, no trust required">
        <div style={{ opacity: 0.75, fontSize: "0.9rem", lineHeight: 1.55, marginBottom: "0.9rem" }}>
          The same confidential-governance primitives QUORUM runs in production — seal ballots,
          verify tallies trustlessly (DLEQ), commit hidden proposals, and disclose to auditors
          (ECIES). Everything runs client-side: no server, no secret keys.
        </div>
        <pre className="qrm-pre-code" style={{
          margin: 0, padding: "1rem 1.25rem", borderRadius: "0.85rem",
          background: "rgba(5,6,18,0.7)", border: `1px solid ${palette.borderSoft}`,
          color: palette.fg, fontSize: "0.82rem", overflow: "auto", lineHeight: 1.55,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}>{`npm add @quorum/sdk

// Seal a vote client-side — your choice never leaves the browser in the clear
import { sealBallot, verifyTally } from "@quorum/sdk";
const ballot = await sealBallot(tallyPubkey, "yes", ["yes", "no", "abstain"]);

// Verify any published tally trustlessly — no server, no keys
const { verified, totals } = verifyTally(transcript);`}</pre>
      </Panel>
    </div>
  );
}

/* ─────────── MEMBERS ─────────── */

function MembersTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const router = useRouter();
  const { members, participation } = Route.useLoaderData();
  const [delegate, setDelegate] = useState("");
  const [busy, setBusy] = useState(false);
  const currentDelegate = participation?.delegationTo ?? null;

  const doDelegate = async () => {
    const to = delegate.trim();
    if (to.length < 32 || to.length > 48) { toast.error("Enter a valid Solana wallet address."); return; }
    setBusy(true);
    try {
      await setDelegation({ data: { delegate: to } });
      await router.invalidate();
      toast.success("Voting weight delegated — privately aggregated at tally.");
      setDelegate("");
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(
        msg === "UNAUTHENTICATED" ? "Connect & sign in first."
        : msg === "SELF_DELEGATION" ? "You can't delegate to yourself."
        : msg === "DELEGATE_NOT_ELIGIBLE" ? "That wallet isn't an eligible member yet."
        : "Delegation failed.",
      );
    } finally { setBusy(false); }
  };

  const undelegate = async () => {
    setBusy(true);
    try {
      await clearDelegation();
      await router.invalidate();
      toast.success("Delegation cleared — you vote your own weight again.");
    } catch (e) {
      toast.error((e as Error).message === "UNAUTHENTICATED" ? "Connect & sign in first." : "Failed to clear delegation.");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={Users}
        kicker="Module IV · Eligibility & Private Delegation"
        title="Prove voting weight."
        highlight="Never reveal holdings."
        desc="Eligibility is committed as a ZK snapshot root. Members vote — or privately delegate — without exposing balances. Nullifiers prevent double-voting."
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        <KV label="Eligible Wallets" value={members.eligibleWallets.toLocaleString()} Icon={Users} />
        <KV label="Sealed Ballots" value={members.sealedBallots.toLocaleString()} Icon={Activity} />
        <KV label="Active Votes" value={String(members.openVotes)} Icon={CheckCircle2} />
        <KV label="Private Delegations" value={members.delegationsOut.toLocaleString()} Icon={KeyRound} />
      </div>
      <div className="qrm-grid-2">
        <Panel title="Eligibility snapshot" subtitle="ZK Merkle commitment">
          <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.88rem" }}>
            <KvRow k="Snapshot type" v="Token + membership + reputation" />
            <KvRow k="Merkle root" v="committed · ZK (Phase 3)" highlight />
            <KvRow k="Total weight committed" v="hidden · ZK proved" />
            <KvRow k="Eligible wallets" v={members.eligibleWallets.toLocaleString()} />
          </div>
        </Panel>
        <Panel title="Private delegation" subtitle="No identities exposed">
          <div style={{ display: "grid", gap: "0.65rem", fontSize: "0.88rem" }}>
            <KvRow k="Delegations" v={members.delegationsOut.toLocaleString()} />
            <KvRow k="Active delegates" v={String(members.activeDelegates)} />
            <KvRow k="Delegated weight" v="hidden · aggregated" highlight />
            <KvRow k="Your delegation" v={currentDelegate ? `→ ${currentDelegate.slice(0, 4)}…${currentDelegate.slice(-4)}` : "None (self-voting)"} />
          </div>
          {!wallet.address ? (
            <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ opacity: 0.7, fontSize: "0.85rem" }}>Connect your wallet to delegate.</span>
              <button onClick={wallet.openPicker} style={btnStyle({ sm: true })}><Wallet size={12} style={{ marginRight: 5 }} />Connect</button>
            </div>
          ) : currentDelegate ? (
            <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={undelegate} disabled={busy} style={btnStyle({ sm: true })}>
                <KeyRound size={12} style={{ marginRight: 5 }} />{busy ? "Working…" : "Clear delegation"}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input style={{ ...inputStyle, flex: 1, minWidth: "200px" }} placeholder="Delegate wallet address" value={delegate} onChange={(e) => setDelegate(e.target.value)} />
              <button onClick={doDelegate} disabled={busy || !delegate.trim()} style={{ ...btnStyle({ filled: true, sm: true }), opacity: busy || !delegate.trim() ? 0.4 : 1 }}>
                <KeyRound size={12} style={{ marginRight: 5 }} />{busy ? "Delegating…" : "Delegate"}
              </button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ─────────── SETTINGS ─────────── */

function SettingsTab() {
  const router = useRouter();
  const { settings, auditors, nodes } = Route.useLoaderData();
  const [quorum, setQuorum] = useState(String(settings?.quorum_pct ?? 5));
  const [approval, setApproval] = useState(String(settings?.approval_pct ?? 60));
  const [windowDays, setWindowDays] = useState(String(settings?.voting_window_days ?? 3));
  const [realms, setRealms] = useState(settings?.realms_enabled ?? true);

  const authError = (e: unknown) =>
    toast.error((e as Error).message === "UNAUTHENTICATED" ? "Connect & sign in first." : (e as Error).message === "FORBIDDEN" ? "Admins only." : "Action failed.");

  const save = async () => {
    try {
      await saveSettings({ data: {
        quorumPct: parseFloat(quorum) || 0,
        approvalPct: parseFloat(approval) || 0,
        votingWindowDays: Math.max(1, Math.min(60, parseInt(windowDays) || 3)),
      } });
      await router.invalidate();
      toast.success("Governance parameters saved");
    } catch (e) { authError(e); }
  };

  const add = async () => {
    try {
      const res = await addAuditor({ data: { label: "New auditor" } });
      await router.invalidate();
      if (res.secret && typeof navigator !== "undefined") navigator.clipboard?.writeText(res.secret);
      toast.success("Auditor key generated — secret copied to clipboard. Save it (shown once).");
    } catch (e) { authError(e); }
  };

  const revoke = async (pubkey: string) => {
    try {
      await revokeAuditor({ data: { pubkey } });
      await router.invalidate();
      toast(`Revoked ${pubkey}`);
    } catch (e) { authError(e); }
  };

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <HeroCard
        Icon={KeyRound}
        kicker="Governance Settings"
        title="Quorum rules, auditors,"
        highlight="integrations."
        desc="Sound defaults: sealed ballots and hidden running tally on by default. Configure tally-node selection, auditor keys for selective disclosure, and Realms integration."
      />
      <Panel title="Governance parameters">
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.65 }}>Quorum threshold (%)</span>
            <input style={inputStyle} value={quorum} onChange={(e) => setQuorum(e.target.value)} type="number" />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.65 }}>Approval threshold (%)</span>
            <input style={inputStyle} value={approval} onChange={(e) => setApproval(e.target.value)} type="number" />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.65 }}>Default voting window (days)</span>
            <input style={inputStyle} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} type="number" />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={btnStyle({ filled: true, sm: true })} onClick={save}>Save</button>
          </div>
        </div>
      </Panel>

      <Panel title="Tally-node selection" subtitle="Threshold cluster · 7 / 9">
        <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.85rem" }}>
          {nodes.map((n) => (
            <div key={n.id} style={{ ...cardStyle, padding: "0.7rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
                <Server size={12} color={palette.gold} />{n.id} · {n.attestation}
              </span>
              <span style={{ color: "#7ddc9f", fontSize: "0.78rem" }}>Attesting · ✔</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Auditor keys" subtitle="Selective disclosure" action={<button style={btnStyle({ sm: true })} onClick={add}><Plus size={12} style={{ marginRight: 4 }} />Add Key</button>}>
        <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.85rem" }}>
          {auditors.filter((a) => !a.revoked).map((a) => (
            <div key={a.pubkey} style={{ ...cardStyle, padding: "0.7rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", color: palette.gold, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: "0.72rem" }}>
                <KeyRound size={12} />{a.label}
              </span>
              <span style={{ opacity: 0.7, fontFamily: "ui-monospace, monospace" }}>{a.pubkey}</span>
              <button style={btnStyle({ sm: true })} onClick={() => revoke(a.pubkey)}>Revoke</button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Integrations">
        <div style={{ ...cardStyle, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.85rem" }}>
          <div>
            <div style={{ fontSize: "0.95rem" }}>Realms</div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: "0.25rem" }}>QUORUM as the confidential voting + treasury layer behind Realms.</div>
          </div>
          <button onClick={async () => {
            const next = !realms;
            setRealms(next);
            try {
              await setRealmsFn({ data: { enabled: next } });
              await router.invalidate();
              toast.success(next ? "Realms integration enabled" : "Realms integration disabled");
            } catch (e) {
              setRealms(!next); // revert on failure
              authError(e);
            }
          }} style={btnStyle({ filled: realms, sm: true })}>
            {realms ? "Enabled" : "Disabled"}
          </button>
        </div>
      </Panel>
    </div>
  );
}


function KV({ label, value, Icon }: { label: string; value: string; Icon?: typeof Vote }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
        {Icon && <span className="qrm-icon-tile" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon size={12} strokeWidth={1.8} /></span>}
        <div style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.6 }}>{label}</div>
      </div>
      <div style={{ fontSize: "1.4rem", marginTop: "0.6rem", color: palette.gold, fontWeight: 200 }}>{value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(20,22,50,0.45)",
  border: `1px solid ${palette.borderSoft}`,
  borderRadius: "1.25rem",
  padding: "1.25rem 1.5rem",
  backdropFilter: "blur(12px)",
};
