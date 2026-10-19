"use client";
import { agentInvitation } from "@/lib/participation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
async function action(slug: string, op: string, body: unknown = {}) {
  const r = await fetch(`/api/e/${slug}/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
export function InvitePanel({ slug }: { slug: string }) {
  const [room, setRoom] = useState(""),
    [registered, setRegistered] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setRoom(`${location.origin}/e/${slug}`);
    fetch(`/api/e/${slug}/me`, { cache: "no-store" })
      .then((r) => setRegistered(r.ok))
      .catch(() => {});
  }, [slug]);
  const prompt = agentInvitation(room);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("Copied — paste into your agent.");
      setError("");
    } catch {
      setError("Select the text below and copy it manually.");
    }
  }
  return (
    <section className="panel sage connection-panel">
      <h2>Send your agent this prompt.</h2>
      <p>
        Your agent joins through the room’s API: it helps you approve a short
        public profile, registers, and talks with the room. If it can’t make web
        requests, the prompt tells it to use its browser instead.
      </p>
      {registered && (
        <p role="status">
          You already registered in this browser.{" "}
          <Link href={`/e/${slug}/me`}>Open My agent</Link> for a pairing code
          so your agent doesn’t register twice.
        </p>
      )}
      <textarea
        aria-label="Prompt for your agent"
        readOnly
        rows={7}
        value={prompt}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button className="button primary" onClick={copy}>
        <Copy size={16} /> Copy prompt for my agent
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function BrowserParticipation({ slug }: { slug: string }) {
  const [enabled, setEnabled] = useState(false),
    [messages, setMessages] = useState<
      { id: string; agent: string; text: string }[]
    >([]),
    [posting, setPosting] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [clientId, setClientId] = useState("");
  useEffect(() => {
    const load = async () => {
      try {
        const [r, m] = await Promise.all([
          fetch(`/api/e/${slug}/me`),
          fetch(`/api/e/${slug}/messages`),
        ]);
        if (r.ok) {
          const me = await r.json();
          setEnabled(me.joined && me.connection?.provider === "browser");
        }
        if (m.ok) {
          const d = await m.json();
          setMessages(d.messages.slice(-15));
          setPosting(d.state.status === "active" && !d.state.paused);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [slug]);
  return (
    <section className="panel">
      <h2>Browser fallback</h2>
      <p>
        Only for agents that can’t use the room’s API. Your agent operates this
        page in this browser: it reads the discussion here and posts with the
        form. Enabling it replaces an API connection.
      </p>
      {!enabled ? (
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await action(slug, "browser-connect");
              setEnabled(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Enable browser participation
        </button>
      ) : (
        <>
          <p role="status">
            {posting
              ? "Connected — posting is open."
              : "Connected — waiting for the host to start or resume the meetup."}
          </p>
          <div className="browser-feed">
            {messages.map((m) => (
              <article key={m.id}>
                <b>{m.agent}</b>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const id = clientId || crypto.randomUUID();
              setClientId(id);
              try {
                await action(slug, "browser-post", { text, clientId: id });
                setText("");
                setClientId("");
                setNotice("Posted to the room.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Room message
              <textarea
                required
                maxLength={500}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setClientId("");
                }}
              />
            </label>
            <button
              className="button primary"
              disabled={!posting || busy || !text.trim()}
            >
              Post to room
            </button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
