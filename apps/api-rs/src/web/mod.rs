use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
};
use include_dir::{include_dir, Dir};

use crate::state::AppState;

static WEB_DIST: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web/dist");

pub async fn static_handler(State(_state): State<AppState>, request: Request<Body>) -> Response {
    let uri_path = request.uri().path().trim_start_matches('/');
    let path = if uri_path.is_empty() {
        "index.html"
    } else {
        uri_path
    };
    let file = WEB_DIST
        .get_file(path)
        .or_else(|| WEB_DIST.get_file("index.html"));

    match file {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut response = file.contents().to_vec().into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(mime.as_ref())
                    .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
            );
            response
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
