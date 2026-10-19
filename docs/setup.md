# Setup (everyone, week 1)

ns-3 runs on Linux, so on Windows we use **WSL2 with Ubuntu**. Everyone should use
the **same ns-3 release** so the code builds the same way on every machine.
Agree on one release in week 1 and write it here: `ns-3.__`.

## 1. Install WSL2 (Windows, once)

In an **administrator** PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart when asked, then open "Ubuntu" from the Start menu and create a Linux user.

## 2. Install build tools (inside Ubuntu)

```bash
sudo apt update
sudo apt install -y g++ cmake ninja-build git python3 python3-pip python3-venv
```

## 3. Get and build ns-3 (inside Ubuntu)

Keep ns-3 in the Linux home folder (`~/ns-3`). Building on `/mnt/c` or `/mnt/d` is much slower.

```bash
git clone https://gitlab.com/nsnam/ns-3-dev.git ~/ns-3
cd ~/ns-3
git tag -l "ns-3.4*"          # list releases; check out the one the team agreed on
git checkout ns-3.XX
./ns3 configure --build-profile=optimized --disable-examples --disable-tests \
    --enable-modules="core;network;internet;point-to-point;applications;traffic-control"
./ns3 build
```

Use `--build-profile=debug` instead while you are developing, so `NS_LOG` output and
assertions work. Use `optimized` for the big sweeps (several times faster).

## 4. Link the project into ns-3 and run the smoke test

The repository on drive D: is visible in Ubuntu as `/mnt/d/...`:

```bash
cd "/mnt/d/PROJECTS/CN PROJECT"
bash scripts/link-into-ns3.sh ~/ns-3
cd ~/ns-3
./ns3 build
./ns3 run "loss-diff-sim --duration=5 --outDir=/tmp/loss-diff"
ls /tmp/loss-diff     # features_*.csv and summary_*.csv
```

## 5. Python (ML and plots)

Works on Windows or inside Ubuntu:

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows; on Ubuntu: source .venv/bin/activate
pip install -r ml/requirements.txt
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `\r: command not found` when running a script | The file has Windows line endings. `.gitattributes` prevents this for new checkouts; fix an existing file with `sed -i 's/\r$//' <file>` |
| ns-3 says more than one file has an entry point | Only `sim/loss-diff-sim.cc` may contain the word `main`. See docs/interfaces.md |
| New `.cc` file not compiled | Re-run `scripts/link-into-ns3.sh`, then `./ns3 build` |
| `Unknown TCP variant` | Variant names differ between ns-3 releases; list them with `ls ~/ns-3/src/internet/model/tcp-*.h` |
