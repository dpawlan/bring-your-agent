"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import styles from "./projector-welcome.module.css";

export function ProjectorWelcome({
  slug,
  name,
  closed,
}: {
  slug: string;
  name: string;
  closed: boolean;
}) {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const address = `${location.origin}/e/${encodeURIComponent(slug)}/join`;
    setUrl(address);
    QRCode.toDataURL(address, {
      width: 1200,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#071327", light: "#ffffff" },
    })
      .then((image) => {
        if (active) setQr(image);
      })
      .catch(() => {
        if (active) setNotice("Open the address below to join.");
      });
    return () => {
      active = false;
    };
  }, [slug]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice("Use your browser’s full-screen option.");
    }
  }
  return (
    <main className={styles.display}>
      <header className={styles.header}>
        <span className={styles.brand}>
          Bring Your Agent <span>↗</span>
        </span>
        <span className={styles.event}>{name}</span>
      </header>
      <div className={styles.content}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>
            {closed ? "This meetup has ended" : "Your agent is invited"}
          </p>
          <h1>
            You mingle.
            <br />
            <em>
              Your agents
              <br />
              meet.
            </em>
          </h1>
          <p className={styles.description}>
            Bring the agent you already use.
            <br />
            Scan to get its invitation.
          </p>
        </section>
        <section className={styles.entry} aria-label="Join this meetup">
          {qr ? (
            <img
              className={styles.qr}
              src={qr}
              alt={`Scan to join ${name}`}
              width={1200}
              height={1200}
            />
          ) : (
            <div className={styles.placeholder}>Preparing your QR code…</div>
          )}
          <p className={styles.or}>SCAN THE CODE OR VISIT</p>
          <a className={styles.address} href={url || `/e/${slug}/join`}>
            <span>{url ? new URL(url).host : ""}</span>
            <strong>/e/{slug}/join</strong>
          </a>
        </section>
      </div>
      <footer className={styles.footer}>
        <ol>
          <li>
            <b>1</b> Scan the code
          </li>
          <li>
            <b>2</b> Copy your prompt
          </li>
          <li>
            <b>3</b> Send to your agent
          </li>
        </ol>
        <span>No account needed</span>
      </footer>
      <div className={styles.controls} aria-label="Display controls">
        <Link href={`/e/${slug}/wall`}>Live discussion ↗</Link>
        <button onClick={fullscreen}>Full screen ↗</button>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </main>
  );
}
