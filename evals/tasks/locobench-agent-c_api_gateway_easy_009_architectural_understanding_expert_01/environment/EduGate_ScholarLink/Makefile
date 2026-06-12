# ------------------------------------------------------------------------------
# EduGate ScholarLink – Makefile
# ------------------------------------------------------------------------------
# Build orchestration for the EduGate ScholarLink API-Gateway written in C.
#
#  Targets:
#     all (default)     – Build release binary
#     debug             – Build with debug symbols & sanitizers
#     plugins           – Build pluggable shared-object modules
#     test              – Build & run unit tests
#     coverage          – Produce gcov/lcov coverage report
#     install           – Install binary, headers, plugins & man pages
#     uninstall         – Remove installed artifacts
#     clean / distclean – Wipe intermediates or everything including deps
#
#  Author: EduGate Core Team
#  License: MIT
# ------------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Tool-chain configuration
# ---------------------------------------------------------------------------
CC              ?= gcc
AR              ?= ar
RM              ?= rm -f
MKDIR_P         ?= mkdir -p

PREFIX          ?= /usr/local
BINDIR          ?= $(PREFIX)/bin
INCLUDEDIR      ?= $(PREFIX)/include/edugate
LIBDIR          ?= $(PREFIX)/lib/edugate
PLUGINDIR       ?= $(PREFIX)/lib/edugate/plugins
MANDIR          ?= $(PREFIX)/share/man/man1

# ---------------------------------------------------------------------------
# Build parameters
# ---------------------------------------------------------------------------
MAJOR           := 0
MINOR           := 9
PATCH           := 3
VERSION         := $(MAJOR).$(MINOR).$(PATCH)

TARGET          := bin/edugate_gateway
STATIC_LIB      := build/libedugate.a

CSTD            := c11
WARNINGS        := -Wall -Wextra -Wpedantic -Werror -Wmissing-prototypes \
                   -Wstrict-prototypes -Wformat=2
OPT_RELEASE     := -O2
OPT_DEBUG       := -Og -g3 -fsanitize=address,undefined,leak
DEFS            := -D_POSIX_C_SOURCE=200809L -D_EDUGATE_VERSION=\"$(VERSION)\"

INCLUDE_DIRS    := -Iinclude -Isrc
LIBS_INTERNAL   := $(STATIC_LIB)
LIBS_EXTERNAL   := -lcurl -lcjson -lgraphqlparser -lm -lpthread

# Generate dependency files *.d via -MMD.
DEPFLAGS        := -MMD -MP

# ---------------------------------------------------------------------------
# Environment override toggles
#   make DEBUG=1      → debug build
#   make COVERAGE=1   → instrumentation for gcov
# ---------------------------------------------------------------------------
ifeq ($(DEBUG),1)
    CFLAGS      := $(WARNINGS) $(OPT_DEBUG) $(DEFS) -std=$(CSTD) \
                   $(INCLUDE_DIRS) $(DEPFLAGS)
    LDFLAGS     := $(OPT_DEBUG) -fsanitize=address,undefined,leak
else
    CFLAGS      := $(WARNINGS) $(OPT_RELEASE) $(DEFS) -std=$(CSTD) \
                   $(INCLUDE_DIRS) $(DEPFLAGS)
    LDFLAGS     :=
endif

ifeq ($(COVERAGE),1)
    CFLAGS      += --coverage
    LDFLAGS     += --coverage
    LIBS_EXTERNAL += --coverage
endif

# ---------------------------------------------------------------------------
# Source layout
# ---------------------------------------------------------------------------
SRC_CORE        := \
    src/main.c \
    src/router/router.c \
    src/validator/validator.c \
    src/graphql/schema_registry.c \
    src/metrics/metrics.c \
    src/doc/doc_generator.c \
    src/util/http.c \
    src/util/log.c \
    src/util/error.c

SRC_PLUGINS     := \
    plugins/quota/quota.c \
    plugins/auth/auth.c

OBJ_CORE        := $(addprefix build/,$(SRC_CORE:.c=.o))
OBJ_PLUGINS     := $(addprefix build/,$(SRC_PLUGINS:.c=.o))

DEPS            := $(OBJ_CORE:.o=.d) $(OBJ_PLUGINS:.o=.d)

# ---------------------------------------------------------------------------
# Default target
# ---------------------------------------------------------------------------
.PHONY: all
all: $(TARGET)

# ---------------------------------------------------------------------------
# Static library
# ---------------------------------------------------------------------------
$(STATIC_LIB): $(OBJ_CORE)
	@echo "  AR      $@"
	@$(MKDIR_P) $(dir $@)
	@$(AR) rcs $@ $^

# ---------------------------------------------------------------------------
# Executable
# ---------------------------------------------------------------------------
$(TARGET): $(STATIC_LIB) src/cli/edugate_cli.c
	@echo "  CC      $<"
	@$(MKDIR_P) $(dir $@)
	@$(CC) $(CFLAGS) -c $< -o build/cli.o
	@echo "  LD      $@"
	@$(CC) $(LDFLAGS) build/cli.o $(LIBS_INTERNAL) $(LIBS_EXTERNAL) -o $@

# ---------------------------------------------------------------------------
# Plugin shared objects
# ---------------------------------------------------------------------------
plugins: $(patsubst build/%.o,build/%.so,$(OBJ_PLUGINS))

build/plugins/%.so: build/plugins/%.o
	@echo "  LD.SHL  $@"
	@$(CC) -shared $(LDFLAGS) $< -o $@

# ---------------------------------------------------------------------------
# Generic build pattern rules
# ---------------------------------------------------------------------------
build/%.o: %.c
	@echo "  CC      $<"
	@$(MKDIR_P) $(dir $@)
	@$(CC) $(CFLAGS) -fPIC -c $< -o $@

# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------
TEST_DIR        := tests
TEST_BIN        := build/tests_runner

.PHONY: test
test: $(TEST_BIN)
	@echo "  RUN     $<"
	@$(TEST_BIN)

$(TEST_BIN): $(STATIC_LIB) $(wildcard $(TEST_DIR)/*.c)
	@echo "  CC      $(TEST_DIR)/*.c"
	@$(CC) $(CFLAGS) $(TEST_DIR)/*.c -o $@ $(LIBS_INTERNAL) $(LIBS_EXTERNAL)

# ---------------------------------------------------------------------------
# Code coverage
# ---------------------------------------------------------------------------
.PHONY: coverage
coverage: clean
	@$(MAKE) COVERAGE=1 test
	@echo "Generating lcov report..."
	@lcov --capture --directory . --output-file coverage.info
	@genhtml coverage.info --output-directory coverage

# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------
.PHONY: install uninstall
install: all plugins
	@echo "Installing EduGate ScholarLink $(VERSION) into $(PREFIX)"
	$(MKDIR_P) $(DESTDIR)$(BINDIR)
	$(MKDIR_P) $(DESTDIR)$(INCLUDEDIR)
	$(MKDIR_P) $(DESTDIR)$(LIBDIR)
	$(MKDIR_P) $(DESTDIR)$(PLUGINDIR)
	$(MKDIR_P) $(DESTDIR)$(MANDIR)
	install -m 0755 $(TARGET) $(DESTDIR)$(BINDIR)
	install -m 0644 $(STATIC_LIB) $(DESTDIR)$(LIBDIR)
	install -m 0755 $(patsubst build/%.o,build/%.so,$(OBJ_PLUGINS)) \
		$(DESTDIR)$(PLUGINDIR)
	cp -r include/edugate $(DESTDIR)$(INCLUDEDIR)
	gzip -c docs/edugate.1 > $(DESTDIR)$(MANDIR)/edugate.1.gz

uninstall:
	@echo "Uninstalling EduGate ScholarLink from $(PREFIX)"
	$(RM) $(DESTDIR)$(BINDIR)/edugate_gateway
	$(RM) $(DESTDIR)$(LIBDIR)/libedugate.a
	$(RM) $(DESTDIR)$(PLUGINDIR)/*.so
	$(RM) -r $(DESTDIR)$(INCLUDEDIR)
	$(RM) $(DESTDIR)$(MANDIR)/edugate.1.gz

# ---------------------------------------------------------------------------
# Cleaning Targets
# ---------------------------------------------------------------------------
.PHONY: clean distclean
clean:
	@echo "Cleaning intermediates..."
	$(RM) -r build

distclean: clean
	@echo "Removing generated binaries, coverage & dependency files..."
	$(RM) -r coverage coverage.info $(TARGET)

# ---------------------------------------------------------------------------
# Include auto-generated dependency files
# ---------------------------------------------------------------------------
-include $(DEPS)

# ------------------------------------------------------------------------------
# End of Makefile
# ------------------------------------------------------------------------------