<div align="center">
  <img src=".github/assets/pako-icon.png" width="140" alt="Pako — a green parrot mascot" />

  <h1>Pako</h1>

  <p><strong>Your local-first English speaking coach.</strong><br />
  Talk. Get corrected. Get better. Nothing leaves your Mac.</p>

  <p>
    <a href="#pt-br">🇧🇷 Ler em Português</a>
    ·
    <a href="#features">Features</a>
    ·
    <a href="#getting-started">Getting Started</a>
    ·
    <a href="#privacy--data">Privacy</a>
  </p>

  <p>
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
    <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-black.svg" />
    <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg" />
    <img alt="100% local by default" src="https://img.shields.io/badge/runs-100%25%20local-2E7D32.svg" />
  </p>
</div>

---

Why "Pako"? Parrots learn language by listening closely and repeating it back until it sounds
right — which is exactly what practicing a new language feels like. Pako is your desktop practice
partner for that: a native macOS app that listens to you speak, transcribes it, replies like a
patient tutor, and speaks back — entirely on your machine, no cloud account required.

## Features

- 🎙️ **Push-to-talk conversation practice** — hold a key, speak naturally, get a spoken reply from
  a local LLM tutor. Corrections are shown separately so they never interrupt the conversation.
- 🧭 **Scenario packs** — practice real situations (ordering coffee, a job interview, small talk)
  instead of an open-ended chat with nowhere to go.
- 📊 **CEFR level assessment** — a short spoken check estimates your level (A1–C2) and adapts
  tutoring intensity to match it.
- 🔁 **Repair loop & spaced retrieval** — mistakes worth fixing come back later, spaced out, so
  they actually stick.
- 🗣️ **Pronunciation practice** — drill a specific phrase and see how close you got.
- 👂 **Listening & accent progression** — checks that train your ear, not just your mouth.
- 📈 **Progress & history** — every session is saved locally so you can see trends and revisit past
  conversations.
- 🔊 **Choice of voices** — macOS's built-in `say`, a fully local [Kokoro](https://github.com/lucasjinreal/kokoros)
  voice, or ElevenLabs if you want a cloud voice and don't mind that one leaving your machine.
- 🗄️ **Your data, your file** — everything lives in one local SQLite database you can export,
  import, or wipe at any time from the Storage page.

## How it works

```mermaid
flowchart LR
    A[🎙️ You speak] --> B["Local transcription\n(whisper.cpp)"]
    B --> C["Local tutor\n(Ollama)"]
    C --> D["Text reply +\nseparate corrections"]
    D --> E["Spoken reply\n(macOS say / Kokoro / ElevenLabs*)"]
    E --> F[🔈 Pako talks back]

    style A fill:#2E7D32,color:#fff
    style F fill:#2E7D32,color:#fff
```

Everything in the loop runs on your Mac by default. The only optional exception is ElevenLabs,
which you have to explicitly configure with your own API key if you want a cloud voice instead of
a local one.

## Tech stack

| Layer | Technology |
|---|---|
| Shell & native bridge | [Tauri 2](https://v2.tauri.app) + Rust |
| UI | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Speech-to-text | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (local) |
| Tutor / LLM | [Ollama](https://ollama.com) (local, bring your own model) |
| Text-to-speech | macOS `say`, [Kokoro](https://github.com/lucasjinreal/kokoros) (local), or ElevenLabs (optional, cloud) |
| Storage | SQLite (local file, exportable) |

## Getting Started

### Prerequisites

- macOS with the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) installed
  (Xcode command line tools, Rust)
- [Bun](https://bun.sh)
- [Ollama](https://ollama.com), running locally with at least one conversational model pulled
- `whisper-cli` and `ffmpeg` for local transcription — easiest via Homebrew:
  ```bash
  brew install whisper-cpp ffmpeg
  ```
  plus a Whisper GGML model (see [docs/done/03-local-transcription-setup.md](docs/done/03-local-transcription-setup.md))

Pako never downloads or pulls any of these for you — install and select each one explicitly in
**Settings**, on purpose, so nothing happens on your machine without your say-so.

### Run it

```bash
git clone https://github.com/jeandiego/pako.git
cd pako
bun install
bun run tauri dev
```

Open **Settings** in the app and point it at your `whisper-cli` binary, your Whisper model file,
and your Ollama model. The System status strip tells you exactly what's missing.

### Build a distributable app

```bash
bun run tauri build
```

### Run the test suite

```bash
bun run test
```

### More setup guides

- [Local transcription setup](docs/done/03-local-transcription-setup.md)
- [Local tutor (Ollama) setup](docs/done/04-local-tutor-setup.md)
- [Local Kokoro voice setup](docs/guides/kokoro-tts-local-setup.md)

## Privacy & data

Pako is built local-first on purpose:

- Microphone recordings, transcripts, and tutor conversations never leave your Mac by default.
- The local tutor only talks to a loopback Ollama URL (`localhost` / `127.0.0.1` / `::1`) —
  LAN addresses, remote hosts, and proxies are rejected.
- The only thing that can leave your machine is speech synthesis text, and only if you explicitly
  opt into the ElevenLabs voice provider with your own API key.
- All session data lives in one local SQLite database, which you fully control from the **Storage**
  page: export it, import it, or wipe it.

## Contributing

Issues and pull requests are welcome. If you're planning a larger change, please open an issue
first to discuss the approach. See [`docs/`](docs) for the project's implementation history and
design notes.

## Acknowledgments

Pako stands on the shoulders of some excellent open-source projects: [Tauri](https://tauri.app),
[whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Ollama](https://ollama.com),
[kokoros](https://github.com/lucasjinreal/kokoros), [shadcn/ui](https://ui.shadcn.com), and
[Tabler Icons](https://tabler.io/icons).

## License

[MIT](LICENSE) © Jean Diego

---

<a id="pt-br"></a>

<details>
<summary><h2 style="display:inline">🇧🇷 Português</h2></summary>

<div align="center">
  <img src=".github/assets/pako-icon.png" width="120" alt="Pako — mascote papagaio" />
  <p><strong>Seu treinador local de inglês falado.</strong><br />
  Fale. Receba correções. Melhore. Nada sai do seu Mac.</p>
</div>

Por que "Pako"? Papagaios aprendem a falar ouvindo com atenção e repetindo até soar certo — que é
exatamente a sensação de praticar um novo idioma. O Pako é seu parceiro de prática para isso: um
app nativo de macOS que escuta você falar, transcreve, responde como um tutor paciente e fala de
volta — tudo no seu computador, sem precisar de conta na nuvem.

### Funcionalidades

- 🎙️ **Prática de conversação push-to-talk** — segure uma tecla, fale naturalmente e receba uma
  resposta falada de um tutor local (LLM). As correções aparecem separadas para nunca interromper
  a conversa.
- 🧭 **Pacotes de cenários** — pratique situações reais (pedir um café, uma entrevista de emprego,
  small talk) em vez de um chat aberto sem direção.
- 📊 **Avaliação de nível CEFR** — um teste falado curto estima seu nível (A1–C2) e ajusta a
  intensidade da tutoria.
- 🔁 **Loop de correção e repetição espaçada** — os erros que valem a pena corrigir voltam depois,
  espaçados no tempo, para realmente fixarem.
- 🗣️ **Prática de pronúncia** — treine uma frase específica e veja o quão perto você chegou.
- 👂 **Progressão de escuta e sotaque** — exercícios que treinam seu ouvido, não só sua fala.
- 📈 **Progresso e histórico** — cada sessão fica salva localmente para você ver sua evolução e
  revisitar conversas passadas.
- 🔊 **Escolha de vozes** — o `say` nativo do macOS, uma voz totalmente local via
  [Kokoro](https://github.com/lucasjinreal/kokoros), ou ElevenLabs se você quiser uma voz na nuvem
  e não se importar que esse trecho saia do seu computador.
- 🗄️ **Seus dados, seu arquivo** — tudo vive em um único banco SQLite local que você pode
  exportar, importar ou apagar a qualquer momento na página Storage.

### Como funciona

```mermaid
flowchart LR
    A[🎙️ Você fala] --> B["Transcrição local\n(whisper.cpp)"]
    B --> C["Tutor local\n(Ollama)"]
    C --> D["Resposta em texto +\ncorreções separadas"]
    D --> E["Resposta falada\n(macOS say / Kokoro / ElevenLabs*)"]
    E --> F[🔈 Pako responde]

    style A fill:#2E7D32,color:#fff
    style F fill:#2E7D32,color:#fff
```

Todo o loop roda no seu Mac por padrão. A única exceção opcional é o ElevenLabs, que precisa ser
configurado explicitamente com sua própria chave de API caso você prefira uma voz na nuvem.

### Stack técnico

| Camada | Tecnologia |
|---|---|
| Shell e ponte nativa | [Tauri 2](https://v2.tauri.app) + Rust |
| Interface | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Fala para texto | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (local) |
| Tutor / LLM | [Ollama](https://ollama.com) (local, você escolhe o modelo) |
| Texto para fala | `say` do macOS, [Kokoro](https://github.com/lucasjinreal/kokoros) (local) ou ElevenLabs (opcional, nuvem) |
| Armazenamento | SQLite (arquivo local, exportável) |

### Como rodar

Pré-requisitos: macOS com os [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/),
[Bun](https://bun.sh), [Ollama](https://ollama.com) rodando localmente com um modelo já baixado, e
`whisper-cli` + `ffmpeg` (`brew install whisper-cpp ffmpeg`) mais um modelo Whisper GGML — veja
[docs/done/03-local-transcription-setup.md](docs/done/03-local-transcription-setup.md).

O Pako nunca baixa ou instala nada disso por você — cada item é instalado e apontado manualmente
em **Settings**, de propósito, para que nada aconteça na sua máquina sem seu consentimento.

```bash
git clone https://github.com/jeandiego/pako.git
cd pako
bun install
bun run tauri dev
```

Abra **Settings** no app e aponte para seu binário `whisper-cli`, o arquivo do modelo Whisper e o
modelo do Ollama. A faixa de status do sistema mostra exatamente o que falta configurar.

Para gerar um app distribuível: `bun run tauri build`. Para rodar os testes: `bun run test`.

### Privacidade e dados

- Gravações de microfone, transcrições e conversas com o tutor nunca saem do seu Mac por padrão.
- O tutor local só se comunica com uma URL loopback do Ollama (`localhost` / `127.0.0.1` / `::1`) —
  endereços de rede local, hosts remotos e proxies são rejeitados.
- A única coisa que pode sair da sua máquina é o texto da fala sintetizada, e só se você optar
  explicitamente pelo provedor de voz ElevenLabs com sua própria chave de API.
- Todos os dados de sessão ficam em um único banco SQLite local, totalmente sob seu controle na
  página **Storage**: exporte, importe ou apague quando quiser.

### Contribuindo

Issues e pull requests são bem-vindos. Para mudanças maiores, abra uma issue primeiro para
discutir a abordagem. Veja [`docs/`](docs) para o histórico de implementação e decisões de design
do projeto.

### Licença

[MIT](LICENSE) © Jean Diego

</details>
