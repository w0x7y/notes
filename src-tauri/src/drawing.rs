use quick_xml::{events::Event, Reader, XmlVersion};

/// Accept only the small inert SVG vocabulary emitted by our drawing renderer.
/// Exported assets may be opened outside the app, so reject scripts, references,
/// CSS, external resources and XML declarations/entities at this boundary.
pub fn validate_svg(svg: &str) -> Result<(), String> {
    if svg.len() > 4_000_000 {
        return Err("Drawing preview is too large".into());
    }
    let mut reader = Reader::from_str(svg);
    let mut depth = 0;
    let mut seen_root = false;
    let mut text = false;
    loop {
        let event = reader.read_event().map_err(|_| "Invalid drawing SVG")?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let name = element.name();
                let name = name.as_ref();
                if depth == 0 {
                    if seen_root || name != "svg" {
                        return Err("Drawing preview requires one SVG root".into());
                    }
                    seen_root = true;
                } else if depth != 1
                    || !["rect", "ellipse", "circle", "path", "text"].contains(&name)
                {
                    return Err("Unsupported drawing SVG element".into());
                }
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|_| "Invalid SVG attribute")?;
                    let key = attribute.key.as_ref();
                    let value = attribute
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|_| "Invalid SVG attribute value")?;
                    let allowed = match key {
                        "xmlns" => name == "svg" && value == "http://www.w3.org/2000/svg",
                        "fill" | "stroke" => {
                            value == "none"
                                || (value.len() == 7
                                    && value.starts_with('#')
                                    && value[1..].bytes().all(|b| b.is_ascii_hexdigit()))
                        }
                        "stroke-linecap" | "stroke-linejoin" => value == "round",
                        "font-family" => value == "sans-serif",
                        "dominant-baseline" => value == "text-before-edge",
                        "direction" => value == "rtl" || value == "ltr",
                        "unicode-bidi" => value == "plaintext",
                        "d" => value
                            .bytes()
                            .all(|b| b.is_ascii_digit() || b"ML .-+eE".contains(&b)),
                        "x" | "y" | "cx" | "cy" | "r" | "rx" | "ry" | "width" | "height"
                        | "viewBox" | "stroke-width" | "fill-opacity" | "font-size" => value
                            .bytes()
                            .all(|b| b.is_ascii_digit() || b" .-+eE".contains(&b)),
                        _ => false,
                    };
                    if !allowed {
                        return Err("Unsupported drawing SVG attribute".into());
                    }
                }
                text = !empty && name == "text";
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => {
                if depth == 0 {
                    return Err("Invalid drawing SVG nesting".into());
                }
                depth -= 1;
                text = false;
            }
            Event::Text(value) => {
                if !text && !value.as_ref().chars().all(char::is_whitespace) {
                    return Err("Unexpected drawing SVG text".into());
                }
            }
            Event::GeneralRef(value) => {
                if !text || !["amp", "lt", "gt", "quot", "apos"].contains(&value.as_ref()) {
                    return Err("Unsupported SVG entity".into());
                }
            }
            Event::Eof => break,
            _ => return Err("Unsupported drawing SVG markup".into()),
        }
    }
    if !seen_root || depth != 0 {
        return Err("Incomplete drawing SVG".into());
    }
    Ok(())
}
