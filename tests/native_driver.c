/* The same glue on the PC (gcc, the plugin's own build of em.c), to check that the
 * JavaScript engine answers exactly like it: tests/test_engine.js prints the same lines. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef unsigned int u32;
static int g_fill;
u32 js_r8(u32 a) { (void)a; return (u32)g_fill; }
u32 js_r16(u32 a) { (void)a; return (u32)(g_fill | (g_fill << 8)); }
u32 js_r32(u32 a) { (void)a; return (u32)(g_fill | (g_fill << 8) | (g_fill << 16) | (g_fill << 24)); }
char *glue_text(void); char *glue_out(void); int *glue_met(void); unsigned char *glue_earned(void);
int glue_load(int len); int glue_step(u32 now_ms); int glue_stable(void);

static int load(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    int n = (int)fread(glue_text(), 1, 64 * 1024, f);
    fclose(f);
    return glue_load(n);
}

int main(int argc, char **argv)
{
    for (int i = 1; i < argc; i++) {
        printf("== %s\n", strrchr(argv[i], '/') ? strrchr(argv[i], '/') + 1 : argv[i]);
        load(argv[i]);
        fputs(glue_out(), stdout);
        for (int fill = 0; fill <= 0xff; fill += 0xff) {
            g_fill = fill;
            load(argv[i]);
            int held = 0, fired = 0;
            for (int t = 1; t <= 180; t++) {
                int k = glue_step((u32)t * 16);
                if (glue_stable() >= 60) held = 1;
                for (int j = 0; j < k; j++) { glue_earned()[glue_met()[j]] = 1; printf("F %d %d\n", fill, glue_met()[j]); fired++; }
            }
            printf("M %d %d %d\n", fill, held, fired);
        }
    }
    return 0;
}
