.PHONY: all build clean

all: build

clean:
	rm -rf build

SOURCE_FILES := $(shell find source -name "*.js")

build: build/JMAP.js

build/JMAP.js: $(SOURCE_FILES)
	mkdir -p $(@D)
	node build.js $^ $@
