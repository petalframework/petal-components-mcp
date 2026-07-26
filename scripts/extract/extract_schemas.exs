# Extracts component schemas from petal_components and emits JSON.
#
# Run from scripts/extract/:
#   mix deps.get
#   mix run extract_schemas.exs
#
# Phoenix.Component generates __components__/0 on any module with attr/slot
# declarations, returning a map keyed by function name. We walk every loaded
# PetalComponents.* module, pull that metadata, and write it to ../../src/schemas.json.

defmodule SchemaExtractor do
  @output_path Path.join([__DIR__, "..", "..", "src", "schemas.json"])

  # Modules to skip — icon packs are huge and not useful for AI suggestion.
  @skip_modules [
    PetalComponents.HeroiconsV1.Outline,
    PetalComponents.HeroiconsV1.Solid,
    PetalComponents.Svg,
    PetalComponents.Helpers,
    PetalComponents.PaginationInternal
  ]

  def run do
    {:ok, modules} = :application.get_key(:petal_components, :modules)

    candidates =
      modules
      |> Enum.filter(&petal_module?/1)
      |> Enum.reject(&(&1 in @skip_modules))

    Enum.each(candidates, &Code.ensure_loaded/1)

    examples = showcase_examples()

    components =
      candidates
      |> Enum.flat_map(&extract_components(&1, examples))
      |> Enum.sort_by(& &1.name)

    output = %{
      version: petal_components_version(),
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      components: components
    }

    File.mkdir_p!(Path.dirname(@output_path))
    File.write!(@output_path, Jason.encode!(output, pretty: true))

    IO.puts("Wrote #{length(components)} components to #{@output_path}")
  end

  defp petal_module?(module) do
    case Module.split(module) do
      # The Showcase namespace is docs tooling (the example gallery + its frame),
      # not app vocabulary - keep it out of the schema AI assistants browse so
      # they never suggest <.showcase_example> inside a user's app.
      ["PetalComponents", "Showcase" | _] -> false
      ["PetalComponents" | _] -> true
      _ -> false
    end
  end

  defp extract_components(module, examples) do
    if function_exported?(module, :__components__, 0) do
      module.__components__()
      |> Enum.map(fn {name, meta} -> build_component(module, name, meta, examples) end)
    else
      []
    end
  end

  defp build_component(module, name, meta, examples) do
    %{
      name: to_string(name),
      module: inspect(module),
      kind: meta[:kind] || :def,
      attrs: Enum.map(meta[:attrs] || [], &build_attr/1),
      slots: Enum.map(meta[:slots] || [], &build_slot/1),
      examples: Map.get(examples, inspect(module), [])
    }
  end

  defp build_attr(attr) do
    %{
      name: to_string(attr.name),
      type: inspect(attr.type),
      required: attr.required || false,
      default: inspect_safe(attr[:opts][:default]),
      values: attr[:opts][:values],
      doc: attr.doc
    }
  end

  defp build_slot(slot) do
    %{
      name: to_string(slot.name),
      required: slot.required || false,
      doc: slot.doc,
      attrs: Enum.map(slot[:attrs] || [], &build_attr/1)
    }
  end

  # The Showcase registry holds curated, compile-checked examples - the same
  # blocks the playground and petal.build render, so they can't drift from the
  # real components. The showcase modules themselves stay out of the catalogue
  # (see petal_module?/1), but their source is exactly what an assistant should
  # copy, so we attach it to the component each module documents.
  defp showcase_examples do
    registry = PetalComponents.Showcase.Registry

    if Code.ensure_loaded?(registry) and function_exported?(registry, :all, 0) do
      Enum.reduce(registry.all(), %{}, fn module, acc ->
        Code.ensure_loaded(module)
        target = showcase_target(module)
        examples = build_examples(module)

        if target && examples != [] do
          Map.update(acc, target, examples, &(&1 ++ examples))
        else
          acc
        end
      end)
    else
      %{}
    end
  end

  defp showcase_target(module) do
    if function_exported?(module, :showcase_component, 0) do
      case module.showcase_component() do
        nil -> nil
        component -> inspect(component)
      end
    end
  end

  defp build_examples(module) do
    if function_exported?(module, :examples, 0) do
      Enum.map(module.examples(), fn ex ->
        %{title: ex.title, description: ex.description, code: ex.code}
      end)
    else
      []
    end
  end

  defp inspect_safe(nil), do: nil
  defp inspect_safe(value), do: inspect(value)

  defp petal_components_version do
    case Application.spec(:petal_components, :vsn) do
      nil -> "unknown"
      vsn -> to_string(vsn)
    end
  end
end

SchemaExtractor.run()
