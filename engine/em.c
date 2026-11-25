/*
 * Emblem - the rule engine: reads a game's text file and looks at the game's
 * memory once a tick. See em.h for the file's format.
 *
 * Every rule whose 'when' holds, of every achievement not yet earned, is
 * worked out on every tick the game is ready, all of it ("and" and "or" never
 * stop half way), so "drops", "just", "was" and the like have last tick's
 * value to compare with. A value used by many rules is worked out once a tick
 * and remembered for the rest of it. A node that was not worked out on the
 * tick before has no "last tick": its over-time words answer no once.
 *
 * Cost on the PSP, measured on the compiled plugin with Felghana's 89 rules:
 * see the numbers in claude/emblem-engine-review.md. What keeps it low:
 *  - rules under a 'when' that does not hold are skipped;
 *  - rules that only look at how things are now ("level >= 10", "all urns")
 *    are looked at every 4th tick; only rules with an over-time word or a
 *    run need every tick;
 *  - the first look after 'ready' starts to hold takes every rule at once,
 *    so a save just loaded is caught up in one go.
 *
 * No PSP calls: the same file is built into the plugin and the PC tests.
 */
#include "em.h"

enum {
    OP_CONST = 1, OP_READ, OP_LIST, OP_AND, OP_OR, OP_NOT,
    OP_EQ, OP_NE, OP_LT, OP_LE, OP_GT, OP_GE, OP_RANGE, OP_SET, OP_OFF,
    OP_DROPS, OP_RISES, OP_CHANGES, OP_WITHIN, OP_JUST, OP_WAS,
    OP_COUNT, OP_ALL, OP_MOVED, OP_MOVEDL, OP_RUN
};
enum { T_U8 = 1, T_U16, T_U32, T_FLOAT };
#define NO_BIT 0xFF

/* ---- small string helpers (no C library needed) ---------------------------- */
static int s_eq(const char *a, const char *b) { while (*a && *a == *b) a++, b++; return *a == *b; }
static int s_len(const char *s) { int n = 0; while (s[n]) n++; return n; }
static void s_copy(char *d, const char *s, int size) { int i = 0; while (s[i] && i < size - 1) { d[i] = s[i]; i++; } d[i] = 0; }
static int is_space(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }
static void zero(void *p, int n) { u8 *b = p; while (n--) *b++ = 0; }

static int parse_num(const char *t, s32 *out)
{
    int neg = 0; u32 v = 0; int digits = 0;
    if (*t == '-') { neg = 1; t++; }
    if (t[0] == '0' && (t[1] == 'x' || t[1] == 'X')) {
        for (t += 2; *t; t++, digits++) {
            int d = (*t >= '0' && *t <= '9') ? *t - '0' : (*t >= 'a' && *t <= 'f') ? *t - 'a' + 10 : (*t >= 'A' && *t <= 'F') ? *t - 'A' + 10 : -1;
            if (d < 0 || digits >= 8) return 0;
            v = v * 16 + (u32)d;
        }
    } else {
        for (; *t; t++, digits++) {
            if (*t < '0' || *t > '9' || digits >= 10) return 0;
            v = v * 10 + (u32)(*t - '0');
        }
    }
    if (!digits) return 0;
    *out = neg ? -(s32)v : (s32)v;
    return 1;
}

static int parse_addr(const char *t, u32 *out)          /* hex, as in the code notes: 08BB9B30 */
{
    u32 v = 0; int digits = 0;
    if (t[0] == '0' && (t[1] == 'x' || t[1] == 'X')) t += 2;
    for (; *t; t++, digits++) {
        int d = (*t >= '0' && *t <= '9') ? *t - '0' : (*t >= 'a' && *t <= 'f') ? *t - 'a' + 10 : (*t >= 'A' && *t <= 'F') ? *t - 'A' + 10 : -1;
        if (d < 0 || digits >= 8) return 0;
        v = v * 16 + (u32)d;
    }
    if (!digits) return 0;
    *out = v;
    return 1;
}

static int parse_ms(const char *t, u32 *out)            /* "3s", "0.5s" */
{
    u32 whole = 0, frac = 0, scale = 1000; int digits = 0;
    for (; *t >= '0' && *t <= '9'; t++, digits++) whole = whole * 10 + (u32)(*t - '0');
    if (*t == '.') for (t++; *t >= '0' && *t <= '9'; t++, digits++) { scale /= 10; frac += (u32)(*t - '0') * scale; }
    if (!digits || t[0] != 's' || t[1] || whole > 3600) return 0;
    *out = whole * 1000 + frac;
    return 1;
}

static int parse_range(const char *t, s32 *lo, s32 *hi)  /* "1..99", "-1..99" */
{
    char a[24];
    int i = 0;
    while (t[i] && !(t[i] == '.' && t[i + 1] == '.') && i < 23) { a[i] = t[i]; i++; }
    if (t[i] != '.' || t[i + 1] != '.') return 0;
    a[i] = 0;
    return parse_num(a, lo) && parse_num(t + i + 2, hi);
}

static const char *const g_reserved[] = {
    "and", "or", "not", "set", "off", "drops", "rises", "changes", "within", "just", "was", "moved",
    "count", "all", "run", "from", "to", "unless", "cancel", "grace", "list", "bit", "none",
    "u8", "u16", "u32", "s32", "float", "game", "when", "show", 0
};
static int reserved(const char *t) { for (int i = 0; g_reserved[i]; i++) if (s_eq(t, g_reserved[i])) return 1; return 0; }
static int name_ok(const char *t)
{
    if (!((*t >= 'a' && *t <= 'z') || (*t >= 'A' && *t <= 'Z') || *t == '_') || reserved(t) || s_len(t) > 23) return 0;
    for (; *t; t++) if (!((*t >= 'a' && *t <= 'z') || (*t >= 'A' && *t <= 'Z') || (*t >= '0' && *t <= '9') || *t == '_')) return 0;
    return 1;
}

/* ---- reading the game ------------------------------------------------------ */
static s32 fint(u32 bits)                               /* float to whole number, no FPU */
{
    int e = (int)((bits >> 23) & 0xFF) - 127;
    u32 m = (bits & 0x7FFFFFu) | 0x800000u;
    s32 v;
    if (e < 0 || e == 128) return 0;            /* tiny, or not a number at all (0xFFFFFFFF is one) */
    if (e > 30) v = 0x7FFFFFFF;
    else v = (s32)(e >= 23 ? m << (e - 23) : m >> (23 - e));
    return (bits & 0x80000000u) ? -v : v;
}
static u32 ones(int type) { return type == T_U8 ? 0xFFu : type == T_U16 ? 0xFFFFu : 0xFFFFFFFFu; }
static u32 raw(int type, u32 a) { return type == T_U8 ? em_r8(a) : type == T_U16 ? em_r16(a) : em_r32(a); }
static s32 read_val(int type, int bit, u32 a)
{
    u32 r = raw(type, a);
    if (bit != NO_BIT) return r == ones(type) ? 0 : (s32)((r >> bit) & 1);
    return type == T_FLOAT ? fint(r) : (s32)r;
}
/* "set": not 0 and not all ones (the games keep "not had" as -1). */
static int val_set(int type, int bit, s32 v)
{
    if (bit != NO_BIT) return v != 0;
    if (type == T_FLOAT) return v != 0 && v != -1;
    return v != 0 && (u32)v != ones(type);
}

/* ---- the parser ------------------------------------------------------------- */
#define MAX_TOK 256
typedef struct {
    EmGame *g;
    char *tk[MAX_TOK];
    int n, pos, in_run, depth;
    const char *err;
} P;

static const char *peek(P *p) { return p->pos < p->n ? p->tk[p->pos] : ""; }
static int accept(P *p, const char *w) { if (p->pos < p->n && s_eq(p->tk[p->pos], w)) { p->pos++; return 1; } return 0; }
static int fail(P *p, const char *msg) { if (!p->err) p->err = msg; return -1; }

static int node(P *p, int op)
{
    EmGame *g = p->g;
    if (g->nnodes >= EM_MAX_NODES) return fail(p, "too many rules in the file (node pool full)");
    EmNode *n = &g->node[g->nnodes];
    zero(n, sizeof(*n));
    n->op = (u8)op; n->k[0] = n->k[1] = n->k[2] = -1; n->bit = NO_BIT; n->depth = 1;
    return g->nnodes++;
}

static int find_def(EmGame *g, const char *name)
{
    for (int i = 0; i < g->ndefs; i++) if (s_eq(g->def[i].name, name)) return g->def[i].node;
    return -1;
}

static int type_of(const char *t)
{
    if (s_eq(t, "u8")) return T_U8;
    if (s_eq(t, "u16")) return T_U16;
    if (s_eq(t, "u32") || s_eq(t, "s32")) return T_U32;
    if (s_eq(t, "float")) return T_FLOAT;
    return 0;
}

static int p_expr(P *p);
static int p_prim0(P *p);
static int p_not0(P *p);
#define P_MAX_NEST 24                           /* brackets and not/just/was inside one another */
static int p_prim(P *p)
{
    if (++p->depth > P_MAX_NEST) { p->depth--; return fail(p, "too many brackets or words inside one another"); }
    int r = p_prim0(p);
    p->depth--;
    return r;
}
static int p_not(P *p)
{
    if (++p->depth > P_MAX_NEST) { p->depth--; return fail(p, "too many brackets or words inside one another"); }
    int r = p_not0(p);
    p->depth--;
    return r;
}

static int p_prim0(P *p)
{
    const char *t = peek(p);
    s32 v; u32 a; int type, i, c;
    if (!*t) return fail(p, "a value is missing");
    if ((type = type_of(t))) {
        p->pos++;
        if (!parse_addr(peek(p), &a)) return fail(p, "an address (hex) is expected after u8/u16/u32/s32/float");
        p->pos++;
        if ((i = node(p, OP_READ)) < 0) return -1;
        p->g->node[i].type = (u8)type; p->g->node[i].a = (s32)a;
        if (accept(p, "bit")) {
            if (!parse_num(peek(p), &v) || v < 0 || v > 31 || type == T_FLOAT) return fail(p, "bit 0..31 expected (not on a float)");
            p->pos++;
            p->g->node[i].bit = (u8)v;
        }
        return i;
    }
    if (accept(p, "(")) {
        if ((i = p_expr(p)) < 0) return -1;
        if (!accept(p, ")")) return fail(p, "a ')' is missing");
        return i;
    }
    if (accept(p, "count") || (s_eq(t, "all") && accept(p, "all"))) {
        int op = s_eq(t, "count") ? OP_COUNT : OP_ALL;
        if ((c = p_prim(p)) < 0) return -1;
        if (p->g->node[c].op != OP_LIST) return fail(p, "count and all need a list");
        if ((i = node(p, op)) < 0) return -1;
        p->g->node[i].k[0] = (s16)c;
        return i;
    }
    if (accept(p, "moved")) {
        if (!p->in_run) return fail(p, "moved only works in a run's 'to' or 'unless'");
        if ((c = p_prim(p)) < 0) return -1;
        EmGame *g = p->g;
        if (g->node[c].op == OP_LIST) {
            if ((i = node(p, OP_MOVEDL)) < 0) return -1;
            if (g->nsnaps + g->node[c].b > EM_MAX_SNAPS) return fail(p, "too many moved lists");
            g->node[i].a = g->nsnaps; g->nsnaps += g->node[c].b;
        } else if ((i = node(p, OP_MOVED)) < 0) return -1;
        g->node[i].k[0] = (s16)c;
        return i;
    }
    if (accept(p, "was")) {
        if ((c = p_prim(p)) < 0) return -1;
        if (p->g->node[c].op == OP_LIST) return fail(p, "was needs a value, not a list");
        if ((i = node(p, OP_WAS)) < 0) return -1;
        p->g->node[i].k[0] = (s16)c;
        return i;
    }
    if (parse_num(t, &v)) {
        p->pos++;
        if ((i = node(p, OP_CONST)) < 0) return -1;
        p->g->node[i].a = v;
        return i;
    }
    if (name_ok(t)) {
        if ((i = find_def(p->g, t)) < 0) return fail(p, "a name that is not defined above");
        p->pos++;
        return i;
    }
    return fail(p, "a value is expected here");
}

static int bin(P *p, int op, int a, int b)
{
    int i = node(p, op);
    if (i < 0) return -1;
    p->g->node[i].k[0] = (s16)a; p->g->node[i].k[1] = (s16)b;
    return i;
}

static int p_cmp(P *p)
{
    static const struct { const char *w; int op; } cmps[] = {
        { "==", OP_EQ }, { "!=", OP_NE }, { "<", OP_LT }, { "<=", OP_LE }, { ">", OP_GT }, { ">=", OP_GE }, { 0, 0 } };
    int a = p_prim(p), b, i;
    s32 lo, hi, v;
    if (a < 0) return -1;
    if (p->g->node[a].op == OP_LIST) return fail(p, "a list needs count, all or moved");
    for (int k = 0; cmps[k].w; k++)
        if (accept(p, cmps[k].w)) {
            if ((b = p_prim(p)) < 0) return -1;
            if (p->g->node[b].op == OP_LIST) return fail(p, "a list needs count, all or moved");
            a = bin(p, cmps[k].op, a, b);
            goto after;
        }
    if (parse_range(peek(p), &lo, &hi)) {
        p->pos++;
        if ((i = node(p, OP_RANGE)) < 0) return -1;
        p->g->node[i].k[0] = (s16)a; p->g->node[i].a = lo; p->g->node[i].b = hi;
        a = i;
    } else if (accept(p, "set") || accept(p, "off")) {
        if ((i = node(p, s_eq(p->tk[p->pos - 1], "set") ? OP_SET : OP_OFF)) < 0) return -1;
        p->g->node[i].k[0] = (s16)a;
        a = i;
    } else if (accept(p, "drops") || accept(p, "rises")) {
        if ((i = node(p, s_eq(p->tk[p->pos - 1], "drops") ? OP_DROPS : OP_RISES)) < 0) return -1;
        p->g->node[i].k[0] = (s16)a;
        if (parse_num(peek(p), &v)) { p->pos++; p->g->node[i].a = v; p->g->node[i].b = 1; }
        a = i;
    } else if (accept(p, "changes")) {
        if ((i = node(p, OP_CHANGES)) < 0) return -1;
        p->g->node[i].k[0] = (s16)a;
        a = i;
    }
after:
    if (a < 0) return -1;
    if (accept(p, "within")) {
        u32 ms;
        if (!parse_ms(peek(p), &ms)) return fail(p, "within needs a time, like 3s or 0.5s");
        p->pos++;
        if ((i = node(p, OP_WITHIN)) < 0) return -1;
        p->g->node[i].k[0] = (s16)a; p->g->node[i].b = (s32)ms;
        a = i;
    }
    return a;
}

static int p_not0(P *p)
{
    int c, i;
    if (accept(p, "not") || accept(p, "just")) {
        int op = s_eq(p->tk[p->pos - 1], "not") ? OP_NOT : OP_JUST;
        if ((c = p_not(p)) < 0) return -1;
        if ((i = node(p, op)) < 0) return -1;
        p->g->node[i].k[0] = (s16)c;
        return i;
    }
    return p_cmp(p);
}
static int p_and(P *p)
{
    int a = p_not(p), b;
    while (a >= 0 && accept(p, "and")) { if ((b = p_not(p)) < 0) return -1; a = bin(p, OP_AND, a, b); }
    return a;
}
static int p_expr(P *p)
{
    int a = p_and(p), b;
    while (a >= 0 && accept(p, "or")) { if ((b = p_and(p)) < 0) return -1; a = bin(p, OP_OR, a, b); }
    return a;
}

static int p_run(P *p)
{
    EmGame *g = p->g;
    if (g->nruns >= EM_MAX_RUNS) return fail(p, "too many runs");
    EmRun *r = &g->run[g->nruns];
    zero(r, sizeof(*r));
    r->unless = r->cancel = -1;
    if (!accept(p, "from")) return fail(p, "run needs 'from'");
    if ((r->from = (s16)p_expr(p)) < 0) return -1;
    if (!accept(p, "to")) return fail(p, "run needs 'to'");
    p->in_run = 1;
    if ((r->to = (s16)p_expr(p)) < 0) return -1;
    if (accept(p, "unless") && (r->unless = (s16)p_expr(p)) < 0) return -1;
    p->in_run = 0;
    if (accept(p, "cancel") && (r->cancel = (s16)p_expr(p)) < 0) return -1;
    if (accept(p, "grace")) {
        if (!parse_ms(peek(p), &r->grace_ms)) return fail(p, "grace needs a time, like 0.5s");
        p->pos++;
    }
    int i = node(p, OP_RUN);
    if (i < 0) return -1;
    g->node[i].a = g->nruns++;
    return i;
}

/* Splits a line into words and operators. The words are copied into a
 * buffer of their own, so the line itself is left as it was. */
static int tokenize(P *p, const char *s)
{
    static char buf[4096];
    int used = 0;
    p->n = p->pos = 0;
    while (*s) {
        while (is_space(*s)) s++;
        if (!*s) break;
        if (p->n >= MAX_TOK) return 0;
        int len;
        if ((s[0] == '=' || s[0] == '!' || s[0] == '<' || s[0] == '>') && s[1] == '=') len = 2;
        else if (s[0] == '(' || s[0] == ')' || s[0] == '=' || s[0] == '<' || s[0] == '>') len = 1;
        else {
            len = 0;
            while (s[len] && !is_space(s[len]) && s[len] != '(' && s[len] != ')' && s[len] != '=' &&
                   s[len] != '<' && s[len] != '>' && !(s[len] == '!' && s[len + 1] == '=')) len++;
            if (!len) len = 1;                          /* a lone '!' */
        }
        if (used + len + 1 > (int)sizeof(buf)) return 0;
        p->tk[p->n++] = buf + used;
        for (int i = 0; i < len; i++) buf[used++] = s[i];
        buf[used++] = 0;
        s += len;
    }
    return 1;
}

static char *trim(char *s)
{
    while (is_space(*s)) s++;
    int n = s_len(s);
    while (n > 0 && is_space(s[n - 1])) s[--n] = 0;
    return s;
}

static void report(EmGame *g, EmErrFn err, int line, const char *msg, const char *text)
{
    g->errors++;
    if (err) err(line, msg, text);
}

/* Works out how deep the nodes made since `from` go, and which have an over-time word
 * under them. 1 if any is too deep. */
static int too_deep(EmGame *g, int from)
{
    int bad = 0;
    for (int i = from; i < g->nnodes; i++) {
        EmNode *n = &g->node[i];
        int d = 0, kid[4] = { n->k[0], n->k[1], n->k[2], -1 };
        if (n->op == OP_RUN) { EmRun *r = &g->run[n->a]; kid[0] = r->from; kid[1] = r->to; kid[2] = r->unless; kid[3] = r->cancel; }
        for (int k = 0; k < 4; k++)
            if (kid[k] >= 0) { if (g->node[kid[k]].depth > d) d = g->node[kid[k]].depth; n->timed |= g->node[kid[k]].timed; }
        if (n->op == OP_DROPS || n->op == OP_RISES || n->op == OP_CHANGES || n->op == OP_WITHIN || n->op == OP_JUST ||
            n->op == OP_WAS || n->op == OP_MOVED || n->op == OP_MOVEDL || n->op == OP_RUN) n->timed = 1;
        n->depth = (u8)(d + 1 > 255 ? 255 : d + 1);
        if (n->depth > EM_MAX_DEPTH) bad = 1;
    }
    return bad;
}

static void do_line(EmGame *g, char *line, int no, EmErrFn err, s16 *gate)
{
    static char copy[2048];
    P p;
    zero(&p, sizeof(p));
    p.g = g;
    int n0 = g->nnodes;
    s_copy(copy, line, sizeof(copy));
    char *s = trim(line);
    if (!*s || *s == '#') return;

    /* an achievement: number | title | points | rule */
    int bars = 0;
    for (char *q = s; *q; q++) bars += *q == '|';
    if (bars) {
        char *f[4]; int nf = 0;
        f[nf++] = s;
        for (char *q = s; *q && nf < 4; q++) if (*q == '|') { *q = 0; f[nf++] = q + 1; }
        s32 id, pts;
        if (bars != 3 || nf != 4) { report(g, err, no, "an achievement line needs: number | title | points | rule", copy); return; }
        if (!parse_num(trim(f[0]), &id) || id < 1 || id > EM_MAX_ID) { report(g, err, no, "achievement number must be 1..255", copy); return; }
        if (!parse_num(trim(f[2]), &pts) || pts < 0 || pts > 255) { report(g, err, no, "points must be 0..255", copy); return; }
        EmAch *a = &g->ach[id];
        if (a->title[0]) { report(g, err, no, "this achievement number is used twice", copy); return; }
        s_copy(a->title, trim(f[1]), EM_TITLE_MAX);
        if (!a->title[0]) s_copy(a->title, "?", EM_TITLE_MAX);
        a->points = (u8)pts; a->rule = -1; a->gate = *gate; a->included = 0;
        for (char *q = f[3]; *q; q++) if (*q == '#') { *q = 0; break; }      /* a comment after the rule */
        if (!tokenize(&p, f[3]) || !p.n) { report(g, err, no, "the rule is missing (write 'none' to list it only)", copy); return; }
        if (p.n == 1 && s_eq(p.tk[0], "none")) return;
        int r = accept(&p, "run") ? p_run(&p) : p_expr(&p);
        if (r >= 0 && p.pos != p.n) { r = -1; fail(&p, "something after the rule could not be read"); }
        if (r < 0) { report(g, err, no, p.err ? p.err : "the rule could not be read", copy); return; }
        if (too_deep(g, n0)) { report(g, err, no, "the rule goes too deep (split it up less, or use fewer names inside names)", copy); return; }
        a->rule = (s16)r; a->included = 1;
        a->timed = g->node[r].timed || (a->gate >= 0 && g->node[a->gate].timed);
        g->total++;
        return;
    }

    /* the rest may carry a comment at the end */
    for (char *q = s; *q; q++) if (*q == '#' && (q == s || is_space(q[-1]))) { *q = 0; break; }
    s = trim(s);

    if (s[0] == 'g' && s[1] == 'a' && s[2] == 'm' && s[3] == 'e' && is_space(s[4])) {
        char *id = trim(s + 5), *t = id;
        while (*t && !is_space(*t)) t++;
        if (*t) *t++ = 0;
        s_copy(g->game, id, sizeof(g->game));
        s_copy(g->title, trim(t), sizeof(g->title));
        return;
    }
    if (!tokenize(&p, s)) { report(g, err, no, "the line is too long", copy); return; }
    if (accept(&p, "when")) {
        if (!p.n || p.pos == p.n) { *gate = -1; return; }
        int r = p_expr(&p);
        if (r >= 0 && p.pos != p.n) { r = -1; fail(&p, "something after the rule could not be read"); }
        if (r >= 0 && too_deep(g, n0)) { r = -1; fail(&p, "the rule goes too deep"); }
        if (r < 0) { report(g, err, no, p.err, copy); *gate = -2; return; }   /* -2: rules below are dropped */
        *gate = (s16)r;
        return;
    }
    if (accept(&p, "show")) {
        while (p.pos < p.n) {
            const char *nm = p.tk[p.pos++];
            int i = find_def(g, nm);
            if (i < 0 || g->node[i].op != OP_READ) { report(g, err, no, "show takes names of plain values (u8/u16/u32/float)", copy); continue; }
            if (g->nshow < EM_MAX_SHOW) { g->show[g->nshow] = (s16)i; s_copy(g->show_name[g->nshow], nm, 12); g->nshow++; }
        }
        return;
    }
    if (p.n >= 3 && s_eq(p.tk[1], "=")) {
        const char *nm = p.tk[0];
        if (!name_ok(nm)) { report(g, err, no, "names are letters, digits and _ (and not a word Emblem uses)", copy); return; }
        if (find_def(g, nm) >= 0) { report(g, err, no, "this name is defined twice", copy); return; }
        if (g->ndefs >= EM_MAX_DEFS) { report(g, err, no, "too many names", copy); return; }
        int r;
        p.pos = 2;
        if (accept(&p, "list")) {
            int type = type_of(peek(&p));
            s32 bit = NO_BIT;
            if (!type) { report(g, err, no, "list needs a type: u8, u16, u32 or float", copy); return; }
            p.pos++;
            if (accept(&p, "bit") && (!parse_num(peek(&p), &bit) || bit < 0 || bit > 31 || type == T_FLOAT)) { report(g, err, no, "bit 0..31 expected", copy); return; }
            if (bit != NO_BIT) p.pos++;
            if ((r = node(&p, OP_LIST)) < 0) { report(g, err, no, p.err, copy); return; }
            EmNode *n = &g->node[r];
            n->type = (u8)type; n->bit = (u8)bit; n->a = g->naddrs;
            for (; p.pos < p.n; p.pos++) {
                u32 a;
                if (!parse_addr(p.tk[p.pos], &a)) { report(g, err, no, "list addresses are hex, like 08BBA2C0", copy); g->nnodes--; return; }
                if (g->naddrs >= EM_MAX_ADDRS) { report(g, err, no, "too many list addresses", copy); g->nnodes--; return; }
                g->addr[g->naddrs++] = a;
            }
            n->b = g->naddrs - n->a;
            if (!n->b) { report(g, err, no, "the list is empty", copy); g->nnodes--; return; }
        } else {
            r = p_expr(&p);
            if (r >= 0 && p.pos != p.n) { r = -1; fail(&p, "something after the rule could not be read"); }
            if (r < 0) { report(g, err, no, p.err, copy); return; }
            if (too_deep(g, n0)) { report(g, err, no, "the rule goes too deep (too many names inside names)", copy); return; }
        }
        s_copy(g->def[g->ndefs].name, nm, 24);
        g->def[g->ndefs++].node = (s16)r;
        if (s_eq(nm, "ready")) {
            if (g->node[r].op == OP_LIST) { report(g, err, no, "ready must be a rule, not a list", copy); return; }
            g->ready = (s16)r;
        }
        return;
    }
    report(g, err, no, "this line could not be read", copy);
}

int em_load(EmGame *g, char *text, int len, EmErrFn err)
{
    zero(g, sizeof(*g));
    g->ready = -1;
    g->tick = 1;
    g->state_every = 4;
    s16 gate = -1;
    char *p = text, *end = text + len;
    for (int no = 1; p < end; no++) {
        char *e = p;
        while (e < end && *e != '\n' && *e) e++;
        int last = e >= end || !*e;
        *e = 0;                                   /* text[len] must be there to hold this */
        if (gate == -2) {
            /* a 'when' that could not be read: its rules are dropped until the next 'when' */
            int bars = 0;
            for (char *c = p; *c; c++) bars += *c == '|';
            if (bars) { report(g, err, no, "dropped: the 'when' above could not be read", p); p = e + 1; if (last) break; continue; }
        }
        do_line(g, p, no, err, &gate);
        if (last) break;
        p = e + 1;
    }
    int n = 0;
    for (int i = 1; i <= EM_MAX_ID; i++) {
        n += g->ach[i].title[0] != 0;
        if (g->ach[i].included) g->ids[g->nids++] = (u8)i;
        if (g->ach[i].included && g->ach[i].timed) g->tids[g->ntids++] = (u8)i;
    }
    return n;
}

int em_included(EmGame *g, int id) { return id >= 1 && id <= EM_MAX_ID && g->ach[id].included; }

/* ---- working the rules out --------------------------------------------------- */
static s32 ev(EmGame *g, int i, u32 now);

static s32 list_el(EmGame *g, EmNode *l, int j) { return read_val(l->type, l->bit, g->addr[l->a + j]); }

/* A run has just started: remember what its "moved" words compare with. */
static void snapshot(EmGame *g, int i, u32 now)
{
    if (i < 0) return;
    EmNode *n = &g->node[i];
    if (n->op == OP_RUN) return;
    if (n->op == OP_MOVED) n->prev = ev(g, n->k[0], now);
    if (n->op == OP_MOVEDL) {
        EmNode *l = &g->node[n->k[0]];
        for (int j = 0; j < l->b; j++) g->snap[n->a + j] = list_el(g, l, j);
    }
    if (n->op == OP_LIST || n->op == OP_MOVED || n->op == OP_MOVEDL) return;
    for (int k = 0; k < 3; k++) snapshot(g, n->k[k], now);
}

/* Lists, the words that look back in time, and runs. Kept out of ev() so the everyday
 * words there stay small and quick. `fresh`: this node was worked out on the tick before,
 * so what it remembers (prev, val) is one tick old. */
static __attribute__((noinline)) s32 ev_slow(EmGame *g, EmNode *n, u32 now)
{
    u32 T = g->tick;
    int fresh = n->tick == T - 1;
    s32 v = 0, c;
    switch (n->op) {
    case OP_LIST:                                 /* its value: how many of its addresses are set */
        for (int j = 0; j < n->b; j++) v += val_set(n->type, n->bit, list_el(g, n, j));
        break;
    case OP_DROPS:
    case OP_RISES: {
        c = ev(g, n->k[0], now);
        s64 diff = (s64)c - (s64)n->prev;         /* now minus last tick */
        if (fresh) {
            if (n->op == OP_DROPS) v = n->b ? diff == -(s64)n->a : diff < 0;
            else                   v = n->b ? diff == (s64)n->a : diff > 0;
        }
        n->prev = c;
        break;
    }
    case OP_CHANGES: c = ev(g, n->k[0], now); v = fresh && c != n->prev; n->prev = c; break;
    case OP_WAS:     c = ev(g, n->k[0], now); v = fresh ? n->prev : 0; n->prev = c; break;
    case OP_JUST:    c = ev(g, n->k[0], now) != 0; v = fresh && c && !n->prev; n->prev = c; break;
    case OP_WITHIN:
        if (ev(g, n->k[0], now)) n->prev = (s32)now;
        v = n->prev && now - (u32)n->prev <= (u32)n->b;
        break;
    case OP_MOVED:  v = ev(g, n->k[0], now) != n->prev; break;
    case OP_MOVEDL: {
        EmNode *l = &g->node[n->k[0]];
        for (int j = 0; j < l->b && !v; j++) v = list_el(g, l, j) != g->snap[n->a + j];
        break;
    }
    case OP_RUN: {
        EmRun *r = &g->run[n->a];
        int rfresh = r->tick == T - 1, started = 0;
        int f = ev(g, r->from, now) != 0;
        if (rfresh && f && !r->pfrom) {            /* the run starts (again) */
            r->armed = 1; r->spoiled = 0; r->t_arm = now;
            snapshot(g, r->to, now);
            snapshot(g, r->unless, now);
            started = 1;
        }
        /* The rest is only looked at while the run is on: most runs are off most of the
         * time. (So their over-time words have no "tick ago" on the tick the run starts,
         * and a run cannot finish on the tick it starts.) */
        if (r->armed) {
            int t = ev(g, r->to, now) != 0;
            int u = r->unless >= 0 ? ev(g, r->unless, now) != 0 : 0;
            int x = r->cancel >= 0 ? ev(g, r->cancel, now) != 0 : 0;
            if (u && now - r->t_arm >= r->grace_ms) r->spoiled = 1;
            if (!started && rfresh && t && !r->pto) { v = !r->spoiled; r->armed = 0; }
            else if (x) r->armed = 0;
            r->pto = (u8)t;
        }
        r->pfrom = (u8)f; r->tick = T;
        break;
    }
    default: break;
    }
    return v;
}

/* A node's value this tick: worked out once, then remembered until the next tick. */
static s32 ev(EmGame *g, int i, u32 now)
{
    EmNode *n = &g->node[i];
    if (n->tick == g->tick) return n->val;
    s32 v, c;
    switch (n->op) {
    case OP_CONST: return n->a;
    case OP_READ:  v = read_val(n->type, n->bit, (u32)n->a); break;
    case OP_AND:   c = ev(g, n->k[0], now); v = ev(g, n->k[1], now) && c; break;      /* both sides, always */
    case OP_OR:    c = ev(g, n->k[0], now); v = ev(g, n->k[1], now) || c; break;
    case OP_NOT:   v = !ev(g, n->k[0], now); break;
    case OP_EQ:    c = ev(g, n->k[0], now); v = c == ev(g, n->k[1], now); break;
    case OP_NE:    c = ev(g, n->k[0], now); v = c != ev(g, n->k[1], now); break;
    case OP_LT:    c = ev(g, n->k[0], now); v = c < ev(g, n->k[1], now); break;
    case OP_LE:    c = ev(g, n->k[0], now); v = c <= ev(g, n->k[1], now); break;
    case OP_GT:    c = ev(g, n->k[0], now); v = c > ev(g, n->k[1], now); break;
    case OP_GE:    c = ev(g, n->k[0], now); v = c >= ev(g, n->k[1], now); break;
    case OP_RANGE: c = ev(g, n->k[0], now); v = c >= n->a && c <= n->b; break;
    case OP_SET:
    case OP_OFF: {
        const EmNode *k = &g->node[n->k[0]];
        c = ev(g, n->k[0], now);
        v = k->op == OP_READ ? val_set(k->type, k->bit, c) : (c != 0 && c != -1);
        if (n->op == OP_OFF) v = !v;
        break;
    }
    case OP_COUNT: v = ev(g, n->k[0], now); break;
    case OP_ALL:   v = ev(g, n->k[0], now) == g->node[n->k[0]].b; break;
    default:       v = ev_slow(g, n, now); break;
    }
    n->val = v; n->tick = g->tick;
    return v;
}

int em_step(EmGame *g, u32 now_ms, const u8 *earned, int *out, int max)
{
    int n = 0;
    g->tick++;
    int ok = g->ready < 0 ? 1 : ev(g, g->ready, now_ms) != 0;
    if (!ok) { g->stable = 0; return 0; }
    int all;                                      /* every rule this tick, or only the timed ones */
    if (g->stable < 60) {
        if (++g->stable < 60) return 0;           /* a second of "ready" before anything counts */
        all = 1;                                  /* the first look: everything, so a loaded save is caught up at once */
    } else all = g->state_every <= 1 || g->tick % (u32)g->state_every == 0;
    const u8 *ids = all ? g->ids : g->tids;
    int nids = all ? g->nids : g->ntids;
    for (int k = 0; k < nids; k++) {
        int id = ids[k];
        EmAch *a = &g->ach[id];
        if (earned && earned[id]) continue;
        if (a->gate >= 0 && !ev(g, a->gate, now_ms)) continue;      /* its 'when' does not hold: not looked at */
        if (ev(g, a->rule, now_ms) && n < max) out[n++] = id;
    }
    return n;
}

s32 em_show_value(const EmGame *g, int i)
{
    if (i < 0 || i >= g->nshow) return 0;
    const EmNode *n = &g->node[g->show[i]];
    return read_val(n->type, n->bit, (u32)n->a);
}

int em_list(EmGame *g, const char *name, const u32 **addrs)
{
    int i = find_def(g, name);
    if (i < 0 || g->node[i].op != OP_LIST) return 0;
    *addrs = &g->addr[g->node[i].a];
    return g->node[i].b;
}
