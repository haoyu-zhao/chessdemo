QUEEN CHESS DEMO

Website: https://haoyu-zhao.github.io/chessdemo/

This repository hosts the chess interface on GitHub Pages. Inference runs on
an H100 server using the official princeton-nlp/queen_pawn-8 checkpoint, bundled
inference implementation, and default generation settings. The UI supports
Chinese and English; explanations retain the original model's English output.

Open an invitation link from the maintainer, choose white or black, and play.
Every model move has its explanation, original output, and predicted variation.
Games can be reviewed and exported as PGN or JSON. The paper's 2697 rating is
not an independent evaluation of this deployed demo. Explanations can be wrong.

The main branch contains only public static assets and a public backend address.
The connection branch's endpoint.json is maintained automatically by the server.
The browser refreshes it when the backend tunnel changes, keeping this website
URL stable. Browser sessions and saved games survive backend hostname changes.
The backend still depends on the server, GPU allocation, and network availability.

Invitation codes, API authentication sessions, deploy private keys, user games,
model weights, and server credentials are not stored in this repository.

Upstream paper: https://arxiv.org/html/2610.03695v1
Model: https://huggingface.co/princeton-nlp/queen_pawn-8
Code: https://github.com/queen-project/queen

Chess piece SVGs: Wikimedia Cburnett, via python-chess (GPL; included license).
https://python-chess.readthedocs.io/en/latest/svg.html
Noto Sans SC font subset: SIL Open Font License, static/fonts/OFL.txt.
The Queen model and weights are not redistributed by this frontend repository.
