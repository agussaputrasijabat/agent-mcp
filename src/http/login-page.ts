export function loginPage(): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Masuk</title>
  </head>
  <body>
    <main>
      <h1>Masuk</h1>
      <form id="login">
        <label>Email <input name="email" type="email" autocomplete="username" required /></label>
        <label>Kata sandi <input name="password" type="password" autocomplete="current-password" required /></label>
        <button type="submit">Masuk</button>
      </form>
      <p id="error" hidden>Nama atau kata sandi salah.</p>
    </main>
    <script>
      document.querySelector("#login").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: form.email.value,
            password: form.password.value,
          }),
        });
        if (response.ok) {
          location.href = "/";
          return;
        }
        document.querySelector("#error").hidden = false;
      });
    </script>
  </body>
</html>`;
}
