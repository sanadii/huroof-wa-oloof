# Information Architecture

Product language: Arabic-first, RTL.  
Client: React + TypeScript + Vite single-page application.  
Working name: «استوديو الحروف»; treat as provisional until legal/name review.

## Route map

| Route | Surface | Primary user | Purpose |
|---|---|---|---|
| `/` | Entry | Everyone | Join with room code or create a match |
| `/how-to-play` | Rules | Everyone | Concise visual explanation of board, buzz, capture, path |
| `/host/new` | Setup | Host | Configure rules, teams, questions, and timers |
| `/room/:roomCode/lobby` | Shared lobby | Host/player/audience projection | Join, assign teams, test buzzers, mark ready |
| `/room/:roomCode/host` | Host console | Host | Run the match and adjudicate answers |
| `/room/:roomCode/play` | Player controller | Player | Connection, team identity, buzzer, and personal status |
| `/room/:roomCode/display` | Audience stage | Audience/projector | Board, public question, timer, score, and results |
| `/room/:roomCode/results` | Match summary | Everyone, filtered | Winner, round history, statistics, rematch/share |
| `/questions` | Question administration | Editor/admin | Search, filter, review, and inventory health |
| `/questions/new` | Question editor | Editor/admin | Create a sourced question |
| `/questions/:questionId` | Question editor | Editor/admin | Edit, version, approve, block, or inspect objections |

Room codes are displayed with `dir="ltr"`, uppercase ASCII, and tabular numerals even inside RTL layouts.

## Primary journeys

### Host

`Entry → Create match → Rule setup → Team setup → Buzzer test → Lobby ready → Host console → Round result → Match result → Rematch or close`

### Player

`Entry → Enter room code → Enter name → Confirm team → Test buzzer → Wait ready → Buzz/answer status → Round result → Match result`

### Audience display

`Open display URL → Lobby join code → Live board → Public adjudication feedback → Round result → Match result`

### Question editor

`Inventory → Filter weak letter → Create/edit → Add source and alternatives → Preview normalization → Submit review → Approve or return`

## Screen contracts

### Entry `/`

- Dominant code-native cropped hex-letter composition.
- Working wordmark and concise line: `أسئلة عربية. فريقان. مسار واحد يفوز.`
- Room code field and `انضم إلى غرفة` as primary task.
- `أنشئ مباراة` as distinct secondary action.
- Link to `كيف تلعب؟`; no marketing feature grid.

### Match setup `/host/new`

Steps are visible but not presented as a long wizard unless validation requires it:

1. Match: classic/fast/custom, best of 1/3/5/7.
2. Teams: name, horizontal/vertical identity, accessible colors/pattern preview.
3. Questions: categories, difficulty, stock sufficiency.
4. Timing: first question and opponent chance.
5. Review: full summary and `أنشئ الغرفة`.

Unsaved changes are protected. Creation errors keep all entered values and identify the field/action needed.

### Lobby

- Join code and copy action.
- Two team rosters organized by axis, not color alone.
- Device connection and buzzer-test status.
- Host-only team assignment and start control.
- Audience sees a clean roster and `بانتظار بدء المباراة`.

### Host console

- Board context and active-cell selection.
- Private question panel: letter, category, prompt, accepted answer, alternatives, source.
- Timer controls and buzzer winner.
- Fixed judgment actions: `إجابة صحيحة`, `إجابة خاطئة`, `قبول بديل`, `إلغاء السؤال`.
- Pause, correction, and event log are secondary but always reachable.
- An action that changes awarded ownership requires the current revision and creates an audit reason.

### Player controller

- Player and team identity.
- Connection/ready state.
- One large hexagonal buzzer.
- Explicit copy per state: `استعد`, `اضغط الآن`, `أنت الأسرع — أجب`, `الفرصة للفريق الآخر`, `بانتظار الحكم`, `انقطع الاتصال`.
- No board interaction in V1; the host selects the team’s declared cell.

### Audience display

- The board is the largest element.
- Public question text appears only when the question is live.
- Do not reveal the accepted answer before `QUESTION_FAILED` or a host-approved post-judgment reveal.
- Winner/buzzer identity is announced visually and through a polite live region.
- Operational errors are phrased for a room, not as technical stack traces.

### Results

- Winner and completed path first.
- Rounds won second; optional points and answer accuracy third.
- Timeline answers “how did the match turn?” without exposing private moderation details.
- Actions: `مباراة جديدة`, `إعادة بنفس الإعدادات`, `عرض تقرير الأسئلة` for host.

### Question administration

- Inventory health by letter is the default overview.
- Filters: letter, category, difficulty, status, source state, use count, objection state.
- Editor fields: prompt, canonical answer, normalized answer, alternatives, target letter, category, difficulty, source URL/citation, explanation, status, version notes.
- Never publish machine-generated questions directly without human review.

## Responsive matrix

| Surface | Minimum supported | Preferred | Composition |
|---|---:|---:|---|
| Player | 320×568 | 390×844 | Single column, thumb-zone buzzer |
| Host | 768×1024 | 1440×900 | Stacked at tablet; asymmetric 62/38 desktop |
| Audience | 1024×576 | 1920×1080 | Fixed safe-stage composition with fluid board |
| Admin | 1024×768 | 1440×900 | Filter rail + table/editor; narrow widths show read-only warning |

## Deferred routes

Spotlight bonus, individual “thousands” mode, global seasons, public profiles, economy/rewards, and AI question generation are outside V1 and must not occupy navigation yet.

