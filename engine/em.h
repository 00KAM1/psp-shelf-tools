#ifndef EM_EM_H
#define EM_EM_H
#include <psptypes.h>

/*
 * Emblem - the rule engine. Reads one game's text file (ms0:/EMBLEM/games/<ID>.txt)
 * and evaluates its achievements against the game's memory, one look per tick.
 * No PSP calls: the same file is built into the plugin and the PC tests.
 *
 * The file, line by line ('#' starts a comment):
 *   game ULUS10558 Ys: The Oath in Felghana
 *   level = u32 08BB9B30                     a name for a value or a rule
 *   urns  = list u32 08BBA2C0 08BBA2C4 ...   a list of addresses (count / all / moved)
 *   ready = main or ta                       when the game is really running; held 1 s first
 *   show  level gold                         values for the L+R+RIGHT box (plain reads)
 *   when  main                               rules below also need this
 *   57 | Adol the Shipwrecker | 5 | level >= 10
 *   38 | Never Smelled the Roses | 25 | none          listed, cannot unlock
 *   80 | The Legend Himself | 25 | run from <rule> to <rule> [unless <rule>] [cancel <rule>] [grace 0.5s]
 *
 * Values: u8 / u16 / u32 / s32 / float ADDR [bit N], numbers (12, -1, 0x2a), names.
 * Tests: == != < <= > >=, A..B, set (not 0 and not all ones: the games keep "not had" as -1),
 * off, drops [N], rises [N], changes, within Ns; and, or, not, ( ).
 * A rule under 'when X' is only looked at while X holds; when X starts to hold, the
 * over-time words below have no "tick ago" on the first look.
 * A rule with none of the over-time words below ("level >= 10", "all urns") is looked at
 * every 4th tick (15 times a second); one with any of them, on every tick (60 a second).
 * Over time: just <rule> (true now, false a tick ago), was <value> (a tick ago),
 * moved <value or list> (differs from when the run started; runs only).
 */

#define EM_MAX_ID     255                       /* achievement numbers 1..255 */
#define EM_TITLE_MAX  48
#define EM_MAX_SHOW   9
#define EM_MAX_DEPTH  40                        /* nodes deep; keeps the plugin's stack use small and known */

typedef struct {
    u8  op, type, bit, depth;                   /* depth: how many nodes deep the rule under it goes */
    s16 k[3];                                   /* children */
    u8  timed, pad;                             /* timed: an over-time word or a run is somewhere under it */
    s32 a, b;                                   /* operands (address, number, list, ...) */
    s32 val;  u32 tick;                         /* this tick's value; the tick it was worked out */
    s32 prev;                                   /* last tick's value (or a time, or a snapshot) */
} EmNode;

typedef struct {
    s16 from, to, unless, cancel;
    u32 grace_ms, t_arm, tick;
    u8  armed, spoiled, pfrom, pto;
} EmRun;

typedef struct {
    s16 rule, gate;                             /* gate -1: none */
    u8  points, included, timed;                /* timed: looked at every tick; otherwise every state_every ticks */
    char title[EM_TITLE_MAX];
} EmAch;

#define EM_MAX_NODES 1280
#define EM_MAX_ADDRS 1024
#define EM_MAX_SNAPS 512
#define EM_MAX_RUNS  64
#define EM_MAX_DEFS  192

typedef struct {
    char game[16];
    char title[64];
    int  total;                                 /* achievements with a rule: what the viewer counts */
    EmAch ach[EM_MAX_ID + 1];                   /* by number; title[0] == 0: no such line */
    s16  ready;                                 /* -1: always ready */
    int  nshow;
    s16  show[EM_MAX_SHOW];
    char show_name[EM_MAX_SHOW][12];
    /* state */
    int  stable;                                /* ticks in a row ready has held (60 = 1 s) */
    int  state_every;                           /* rules with no over-time word are looked at every N ticks (4); 1 = all, every tick */
    int  nids, ntids;
    u8   ids[EM_MAX_ID], tids[EM_MAX_ID];       /* the numbers that have a rule, in order; and the timed ones among them */
    u32  tick;
    /* pools */
    int  nnodes, naddrs, nsnaps, nruns, ndefs, errors;
    EmNode node[EM_MAX_NODES];
    u32  addr[EM_MAX_ADDRS];
    s32  snap[EM_MAX_SNAPS];
    EmRun run[EM_MAX_RUNS];
    struct { char name[24]; s16 node; } def[EM_MAX_DEFS];
} EmGame;

/* Memory reads, supplied by the caller (PSP addresses). */
u32 em_r8(u32 a);
u32 em_r16(u32 a);
u32 em_r32(u32 a);

/* Error lines are passed to this (may be 0). */
typedef void (*EmErrFn)(int line, const char *msg, const char *text);

/* Reads a game file held in memory (text is changed while reading). Returns the
 * number of achievement lines read; problems are reported line by line and the
 * rest of the file still counts. */
int em_load(EmGame *g, char *text, int len, EmErrFn err);

/* One look at the game. earned[id] != 0: already unlocked (skipped). Writes the
 * numbers whose rule holds right now into out[], returns how many. Main thread
 * only; now_ms never 0. */
int em_step(EmGame *g, u32 now_ms, const u8 *earned, int *out, int max);

/* 1 if the file has a rule for this number. */
int em_included(EmGame *g, int id);

/* The value of a "show" entry, for the address check box. */
s32 em_show_value(const EmGame *g, int i);

/* For the tests: a define's list of addresses (0 if not a list). */
int em_list(EmGame *g, const char *name, const u32 **addrs);
#endif
