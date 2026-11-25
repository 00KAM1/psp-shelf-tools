/*
 * Shelf Tools - Emblem's rule engine in the browser.
 *
 * em.c is the plugin's own file, copied unchanged from psp-ark-plugins/emblem/src
 * (tests/check_engine_copy.sh says so on every test run). This file only gives it what
 * the plugin's main.c gives it on the PSP: memory reads and a place for error lines.
 *
 * Memory: the page decides what the game's memory holds, through three imported
 * functions (js_r8/js_r16/js_r32). The address checks are the plugin's (emblem/src/main.c),
 * so an address outside the game's RAM, or an unaligned read, gives 0 here too.
 *
 * Built with clang --target=wasm32, no C library (em.c needs none).
 */
#include "em.h"

#ifdef __wasm__
__attribute__((import_module("env"), import_name("js_r8")))  u32 js_r8(u32 a);
__attribute__((import_module("env"), import_name("js_r16"))) u32 js_r16(u32 a);
__attribute__((import_module("env"), import_name("js_r32"))) u32 js_r32(u32 a);
#else
u32 js_r8(u32 a); u32 js_r16(u32 a); u32 js_r32(u32 a);
#endif

u32 em_r32(u32 a) { return (a < 0x08800000u || a > 0x09FFFFFCu || (a & 3)) ? 0 : js_r32(a); }
u32 em_r16(u32 a) { return (a < 0x08800000u || a > 0x09FFFFFEu || (a & 1)) ? 0 : js_r16(a); }
u32 em_r8(u32 a)  { return (a < 0x08800000u || a > 0x09FFFFFFu) ? 0 : js_r8(a); }

/* clang may turn struct copies and clears into these calls (no C library in the wasm build) */
#ifdef __wasm__
void *memset(void *d, int c, unsigned long n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, unsigned long n) { unsigned char *p = d; const unsigned char *q = s; while (n--) *p++ = *q++; return d; }
void *memmove(void *d, const void *s, unsigned long n)
{
    unsigned char *p = d; const unsigned char *q = s;
    if (p < q) while (n--) *p++ = *q++;
    else { p += n; q += n; while (n--) *--p = *--q; }
    return d;
}
#endif

#define TEXT_MAX (64 * 1024)               /* the plugin reads 32 KB; the page warns above that */
#define OUT_MAX  (64 * 1024)

static EmGame g_game;
static char g_text[TEXT_MAX + 1];
static char g_out[OUT_MAX];
static int  g_outlen;
static u8   g_earned[EM_MAX_ID + 1];
static int  g_met[EM_MAX_ID + 8];

static void put(const char *s) { while (*s && g_outlen < OUT_MAX - 1) g_out[g_outlen++] = *s++; g_out[g_outlen] = 0; }
static void put_num(int v)
{
    char b[16]; int n = 0; unsigned u = v < 0 ? (unsigned)-v : (unsigned)v;
    if (v < 0) put("-");
    do { b[n++] = (char)('0' + u % 10); u /= 10; } while (u && n < 15);
    while (n) { char c[2] = { b[--n], 0 }; put(c); }
}
/* tabs and newlines inside a field would break the page's split */
static void put_field(const char *s) { for (; *s && g_outlen < OUT_MAX - 1; s++) g_out[g_outlen++] = (*s == '\t' || *s == '\n' || *s == '\r') ? ' ' : *s; g_out[g_outlen] = 0; }

static void on_error(int line, const char *msg, const char *text)
{
    put("E\t"); put_num(line); put("\t"); put_field(msg ? msg : ""); put("\t"); put_field(text ? text : ""); put("\n");
}

char *glue_text(void) { return g_text; }
char *glue_out(void) { return g_out; }
int  *glue_met(void) { return g_met; }
u8   *glue_earned(void) { return g_earned; }

/* Loads text[0..len). The out buffer then holds tab-separated lines:
 *   E line msg text            an error line (em_load's own wording)
 *   G id title                 the game line
 *   A n points included timed gated title   one per achievement line read
 *   L nodes addrs snaps runs defs nshow ready errors total lines
 * Returns the number of achievement lines read (em_load's answer). */
int glue_load(int len)
{
    if (len < 0) len = 0;
    if (len > TEXT_MAX) len = TEXT_MAX;
    g_text[len] = 0;
    g_outlen = 0; g_out[0] = 0;
    for (int i = 0; i <= EM_MAX_ID; i++) g_earned[i] = 0;
    int lines = em_load(&g_game, g_text, len, on_error);
    put("G\t"); put_field(g_game.game); put("\t"); put_field(g_game.title); put("\n");
    for (int i = 1; i <= EM_MAX_ID; i++) {
        EmAch *a = &g_game.ach[i];
        if (!a->title[0]) continue;
        put("A\t"); put_num(i); put("\t"); put_num(a->points); put("\t"); put_num(a->included); put("\t");
        put_num(a->timed); put("\t"); put_num(a->gate >= 0); put("\t"); put_field(a->title); put("\n");
    }
    put("L\t"); put_num(g_game.nnodes); put("\t"); put_num(g_game.naddrs); put("\t"); put_num(g_game.nsnaps); put("\t");
    put_num(g_game.nruns); put("\t"); put_num(g_game.ndefs); put("\t"); put_num(g_game.nshow); put("\t");
    put_num(g_game.ready >= 0); put("\t"); put_num(g_game.errors); put("\t"); put_num(g_game.total); put("\t"); put_num(lines); put("\n");
    return lines;
}

/* One look, as the plugin's thread makes every 16 ms. Returns how many rules hold
 * (their numbers in glue_met()); the page marks them earned in glue_earned(). */
int glue_step(u32 now_ms) { return em_step(&g_game, now_ms ? now_ms : 1, g_earned, g_met, EM_MAX_ID + 4); }

/* 60 = ready has held for a whole second, so rules are being looked at */
int glue_stable(void) { return g_game.stable; }
int glue_nshow(void) { return g_game.nshow; }
int glue_show_value(int i) { return em_show_value(&g_game, i); }
const char *glue_show_name(int i) { return i >= 0 && i < g_game.nshow ? g_game.show_name[i] : ""; }
