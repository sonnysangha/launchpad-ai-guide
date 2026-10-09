import Link from "next/link";

export default function SetupPage() {
  return <main style={{ maxWidth: 680, margin: "80px auto", padding: 24 }}><Link href="/">← Launchpad</Link><p style={{ marginTop: 48, textTransform: "uppercase", fontSize: 12, letterSpacing: ".15em" }}>Local setup</p><h1 style={{ fontFamily: "Georgia, serif", fontSize: 48, fontWeight: 400 }}>A few connections first.</h1><p style={{ lineHeight: 1.8 }}>This local demo needs its sign-in service configured before you can create a workspace. Follow the setup instructions in the project README, then restart the app.</p><p style={{ lineHeight: 1.8 }}>Avatar conversations also require a LiveKit project, model access, and an eligible Synthesia Interactive Avatar. The app will show a clear connection error until those are available.</p><Link href="/">Return home</Link></main>;
}
