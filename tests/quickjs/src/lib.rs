//! Compatibility tests against the same pinned QuickJS binding used by UniFiles.
#[cfg(test)]
mod tests {
    use rquickjs::{Context, Function, Module, Promise, Runtime};
    use serde_json::{Value, json};

    #[test]
    fn esm_builds_run_in_the_native_interpreter() {
        for source in [
            include_str!("../../../dist/youtube.js"),
            include_str!("../../../dist/index.esm.js"),
        ] {
            let runtime = Runtime::new().unwrap();
            runtime.set_memory_limit(32 * 1024 * 1024);
            runtime.set_max_stack_size(512 * 1024);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            runtime.set_interrupt_handler(Some(Box::new(move || {
                std::time::Instant::now() > deadline
            })));
            let context = Context::full(&runtime).unwrap();
            context.with(|ctx| {
                let (module, ready) = Module::declare(ctx.clone(), "youtube", source).unwrap().eval().unwrap();
                ready.finish::<()>().unwrap();
                let exports = module.namespace().unwrap();
                ctx.globals().set("provider", exports).unwrap();
                // Exercise async exports, parser output and the expected native host boundary.
                ctx.eval::<(), _>(r#"
                    globalThis.requests = [];
                    globalThis.host = {apiVersion:1,http:{async json(request) {
                        requests.push(request);
                        if (request.url.endsWith('/player')) return {
                            playabilityStatus:{status:'OK'},
                            streamingData:{adaptiveFormats:[{mimeType:'audio/mp4',url:'https://r1.googlevideo.com/audio',bitrate:128000}]},
                            videoDetails:{lengthSeconds:'120'}
                        };
                        return {musicTwoRowItemRenderer:{title:{simpleText:'Fixture song'},navigationEndpoint:{watchEndpoint:{videoId:'jNQXAC9IVRw'}}}};
                    }}};
                    globalThis.run = async () => JSON.stringify({
                        page: await provider.browse({sourceInstanceId:'youtube',query:'test'}),
                        playback: await provider.resolve({sourceInstanceId:'youtube',itemId:'jNQXAC9IVRw'}),
                        requests
                    });
                "#).unwrap();
                let run: Function = ctx.globals().get("run").unwrap();
                let result: Promise = run.call(()).unwrap();
                let result: Value = serde_json::from_str(&result.finish::<String>().unwrap()).unwrap();
                assert_eq!(result["page"]["items"][0]["title"], "Fixture song");
                assert_eq!(result["playback"]["durationMs"], 120000);
                assert_eq!(result["requests"][0]["url"], "https://music.youtube.com/youtubei/v1/search");
                let body: Value = serde_json::from_str(result["requests"][1]["body"].as_str().unwrap()).unwrap();
                assert_eq!(body["videoId"], json!("jNQXAC9IVRw"));
            });
        }
    }
}
