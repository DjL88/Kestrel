"""Modulated deformable convolution (torchvision.ops.deform_conv2d) written with ordinary PyTorch ops, so a model that
uses it can be exported to ONNX with standard operators (GridSample, MatMul) that every onnxruntime build runs.

Same maths as torchvision: for each output position and kernel tap, sample the input bilinearly at
(base position + tap offset + learned offset), with zero outside the picture, multiply by the mask, then apply the
convolution weights. Checked against torchvision by tools/model-conversion/birefnet_lite.py (stage `check`).
"""
import torch
import torch.nn.functional as F


def _pair(v):
    return tuple(v) if isinstance(v, (tuple, list)) else (v, v)


def deform_conv2d(input, offset, weight, bias=None, stride=(1, 1), padding=(0, 0), dilation=(1, 1), mask=None):
    n, c, h, w = input.shape
    c_out, c_per_group, kh, kw = weight.shape
    sh, sw = _pair(stride); ph, pw = _pair(padding); dh, dw = _pair(dilation)
    k = kh * kw
    groups = c // c_per_group
    offset_groups = offset.shape[1] // (2 * k)
    ho, wo = offset.shape[2], offset.shape[3]
    dtype, device = input.dtype, input.device

    # Base sampling positions (pixel coordinates) for every tap and output position: [k, ho, wo].
    oy = torch.arange(ho, device=device, dtype=dtype) * sh - ph
    ox = torch.arange(wo, device=device, dtype=dtype) * sw - pw
    ty = (torch.arange(kh, device=device, dtype=dtype) * dh).repeat_interleave(kw)
    tx = (torch.arange(kw, device=device, dtype=dtype) * dw).repeat(kh)
    base_y = ty.view(k, 1, 1) + oy.view(1, ho, 1)
    base_x = tx.view(k, 1, 1) + ox.view(1, 1, wo)

    # torchvision layout: offset[:, g*2k + 2*t] is dy and [..., + 1] is dx for tap t of offset group g.
    off = offset.view(n, offset_groups, k, 2, ho, wo)
    y = base_y[None, None] + off[:, :, :, 0]
    x = base_x[None, None] + off[:, :, :, 1]
    # Pixel centres to grid_sample's [-1, 1] with align_corners=False: (2p + 1) / size - 1.
    grid = torch.stack(((2 * x + 1) / w - 1, (2 * y + 1) / h - 1), dim=-1)  # [n, og, k, ho, wo, 2]

    cg = c // offset_groups
    inp = input.view(n * offset_groups, cg, h, w)
    grid = grid.view(n * offset_groups, k * ho, wo, 2)
    sampled = F.grid_sample(inp, grid, mode='bilinear', padding_mode='zeros', align_corners=False)  # [n*og, cg, k*ho, wo]
    sampled = sampled.view(n, offset_groups, cg, k, ho, wo)
    if mask is not None:
        sampled = sampled * mask.view(n, offset_groups, 1, k, ho, wo)
    cols = sampled.reshape(n, groups, c_per_group * k, ho * wo)  # channel-major then tap, as the weights are laid out
    wts = weight.view(groups, c_out // groups, c_per_group * k)
    out = torch.einsum('gok,ngkl->ngol', wts, cols).reshape(n, c_out, ho, wo)
    if bias is not None:
        out = out + bias.view(1, c_out, 1, 1)
    return out
