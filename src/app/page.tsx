import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowUpRight, Layers3, MessageCircle, Sparkles } from "lucide-react";
import { hasClerkConfiguration } from "@/lib/config";
import { getWorkspace } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = hasClerkConfiguration();
  if (configured) {
    const { userId } = await auth();
    if (userId) redirect(getWorkspace(userId) ? "/dashboard" : "/onboarding");
  }
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px clamp(20px, 5vw, 64px) 72px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
        <Link href="/" style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-.04em", textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}><Layers3 size={27} /> launchpad</Link>
        <Link href={configured ? "/sign-in" : "/setup"}>Sign in <span aria-hidden="true">↗</span></Link>
      </header>
      <section style={{ paddingTop: "clamp(60px, 10vw, 136px)", maxWidth: 820 }}>
        <p style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 700, textTransform: "uppercase" }}>A calmer place to start</p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(48px, 7vw, 86px)", lineHeight: 1.05, letterSpacing: "-.055em", fontWeight: 400, margin: "24px 0" }}>Good projects start<br />with a little clarity.</h1>
        <p style={{ maxWidth: 540, fontSize: 19, lineHeight: 1.65, color: "var(--muted, #63756f)" }}>Meet your guide. Shape your first project together. Go from a blank page to a workspace with a plan.</p>
        <Link href={configured ? "/sign-up" : "/setup"} style={{ display: "inline-flex", alignItems: "center", gap: 24, marginTop: 22, background: "var(--teal, #17665d)", color: "white", padding: "17px 24px", borderRadius: 8, fontWeight: 600, textDecoration: "none" }}>Create your workspace <ArrowUpRight size={20} /></Link>
        <p style={{ fontSize: 12, color: "var(--muted, #63756f)", marginTop: 18 }}>Fictional demo · Sample projects only · No billing or invitations</p>
      </section>
      <section aria-label="Your first steps" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 24, marginTop: 80, borderTop: "1px solid #d7e0d9", paddingTop: 30 }}>
        {[
          { icon: MessageCircle, title: "Talk it through", text: "A conversational avatar helps you find your first step." },
          { icon: Sparkles, title: "Make it yours", text: "Watch the draft take shape. Review every detail before you create." },
          { icon: Layers3, title: "See the way forward", text: "A simple board takes work from Brief to Build, Review, and Handoff." },
        ].map(({ icon: Icon, title, text }, i) => <article key={title}><span style={{ fontSize: 12, color: "var(--muted, #63756f)" }}>0{i + 1}</span><Icon size={22} style={{ display: "block", marginTop: 20 }} /><h2 style={{ fontSize: 18, margin: "16px 0 10px" }}>{title}</h2><p style={{ maxWidth: 290, lineHeight: 1.6, color: "var(--muted, #63756f)" }}>{text}</p></article>)}
      </section>
    </main>
  );
}
