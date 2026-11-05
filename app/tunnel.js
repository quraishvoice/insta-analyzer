// رابط عام مؤقت لملفات محددة وقت النشر بس: انستجرام ما يقبل رفع ملف من جهازك مع طريقة الربط هذي، لازم رابط عام
// نشغّل خادم صغير يقدّم هالملفات بس (تحت مسار سري عشوائي، مو اللوحة)، ونفتح له نفق Cloudflare مجاني بدون حساب،
// وأول ما ينتهي النشر نسكّر الاثنين
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";

const TYPES = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

export function tunnelTool() {
  for (const bin of ["cloudflared", "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]) {
    try { execFileSync(bin, ["--version"], { stdio: "ignore" }); return bin; } catch {}
  }
  return null;
}

// fn تاخذ روابط الملفات بنفس الترتيب. النفق يتسكر بعد ما تخلص fn (نجحت أو فشلت)
export async function withPublicFiles(paths, fn) {
  const bin = tunnelTool();
  if (!bin) throw new Error("أداة cloudflared مو مثبتة. ثبّتها (brew install cloudflared) عشان تشتغل الجدولة.");
  const secret = randomBytes(16).toString("hex");
  const served = new Map(paths.map((p, i) => [`/${secret}/${i}${extname(p).toLowerCase()}`, p]));
  const server = createServer((req, res) => {
    const file = served.get(new URL(req.url, "http://x").pathname);
    if (!file || !["GET", "HEAD"].includes(req.method)) return res.writeHead(404).end();
    const size = statSync(file).size, type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    // انستجرام ممكن يطلب الملف على أجزاء (Range)
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" });
      return req.method === "HEAD" ? res.end() : createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    req.method === "HEAD" ? res.end() : createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error("النفق ما اشتغل خلال دقيقة")), 60000);
      const look = (d) => { const u = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d)); if (u) { clearTimeout(t); ok(u[0]); } };
      proc.stdout.on("data", look); proc.stderr.on("data", look);
      proc.on("exit", () => fail(new Error("النفق وقف قبل ما يشتغل")));
    });
    const urls = [...served.keys()].map((p) => base + p);
    // الرابط الجديد ياخذ ثواني لين ينعرف اسمه: نسأل DNS العام (مو حق الجهاز، لأنه يحفظ «ما لقيته» فترة)
    const host = new URL(base).hostname;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await (await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: "application/dns-json" } })).json();
        if (r.Answer?.length) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    await new Promise((r) => setTimeout(r, 3000));
    return await fn(urls);
  } finally {
    proc.kill();
    server.close();
  }
}
